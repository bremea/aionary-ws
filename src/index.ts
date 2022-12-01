import { WebSocketServer } from "ws";
import { config } from "dotenv";
import * as jose from "jose";
import cycle from "./cycle.js";
import redis from "./redis.js";
import { v4 as uuidv4 } from "uuid";

const wss = new WebSocketServer({ port: 8080, host: "::" });
config();

const secret = new TextEncoder().encode(process.env.JWT);
const alg = "HS256";

let round = 1;

wss.on("connection", (ws) => {
  let uuid: string | undefined;
  let name: string | undefined;

  ws.on("message", async (data) => {
    const msg = JSON.parse(data.toString());
    switch (msg.action) {
      case "join": {
        let newUser = true;
        let cinfo;

        if (msg.token) {
          return ws.send(
            JSON.stringify({
              action: "error",
              msg: "Token reconnect disabled for this server",
              ti: true,
            })
          );
        }

        if (newUser && (!msg.name || msg.name == ""))
          return ws.send(
            JSON.stringify({ action: "error", msg: "Enter a name" })
          );

        uuid = uuidv4();

        const jwt = await new jose.SignJWT({ name: msg.name, uuid: uuid })
          .setProtectedHeader({ alg })
          .setIssuedAt()
          .setIssuer("com:aionary:issuer")
          .setAudience("com:aionary:audience")
          .setExpirationTime("1d")
          .sign(secret);

        ws.send(JSON.stringify({ action: "token", token: jwt, uuid: uuid }));
        if (newUser) {
          name = msg.name;
          const newHm = {};
          newHm[uuid] = 0;
          const newNm = {};
          newNm[uuid] = name;
          await redis.hmset(`${process.env.FLY_ALLOC_ID}:players`, newHm);
          await redis.hmset(`${process.env.FLY_ALLOC_ID}:names`, newNm);
        } else {
          name = await redis.hget(
            `${process.env.FLY_ALLOC_ID}:plnames`,
            cinfo.uuid as string
          );
          const pts = await redis.hget(
            `${process.env.FLY_ALLOC_ID}:plpts`,
            cinfo.uuid as string
          );
          const newHm = {};
          newHm[uuid] = pts;
          const newNm = {};
          newNm[uuid] = name;
          await redis.hmset(`${process.env.FLY_ALLOC_ID}:players`, newHm);
          await redis.hmset(`${process.env.FLY_ALLOC_ID}:names`, newNm);
          redis.hdel(
            `${process.env.FLY_ALLOC_ID}:plnames`,
            cinfo.uuid as string
          );
          redis.hdel(`${process.env.FLY_ALLOC_ID}:plpts`, cinfo.uuid as string);
        }

        const players = await redis.hlen(`${process.env.FLY_ALLOC_ID}:players`);
        wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              action: "addPlayer",
              name: name,
              players: players,
            })
          );
        });

        if (players >= 8 && process.env.PUBLIC_GAME == "true") {
          redis.hdel(`needPlayers:${process.env.SPECIAL == 'true' ? 'special' : 'classic'}`, process.env.FLY_ALLOC_ID);
        } else if (process.env.PUBLIC_GAME == "true") {
          const hv = {};
          hv[process.env.FLY_ALLOC_ID] = players;
          redis.hmset(`needPlayers:${process.env.SPECIAL == 'true' ? 'special' : 'classic'}`, hv);
        }

        const state = parseInt(
          await redis.get(`${process.env.FLY_ALLOC_ID}:state`)
        );
        ws.send(
          JSON.stringify({ action: "gameState", state: state, round: round })
        );

        const lb = (await redis.hgetall(
          `${process.env.FLY_ALLOC_ID}:players`
        )) as unknown as Record<string, number>;
        const names = await redis.hgetall(`${process.env.FLY_ALLOC_ID}:names`);
        const lbSort = Object.keys(lb)
          .sort((a, b) => lb[a] - lb[b])
          .reverse();
        const lbFin = {};

        for (const [i, uuid] of lbSort.entries()) {
          lbFin[uuid] = {
            name: names[uuid],
            pts: lb[uuid],
            pos: i,
          };
        }

        wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              action: "leaderboard",
              leaderboard: lbFin,
            })
          );
        });

        break;
      }
      case "chat": {
        const { payload } = await jose.jwtVerify(msg.token, secret, {
          issuer: "com:aionary:issuer",
          audience: "com:aionary:audience",
        });
        const cinfo = payload;
        if (!cinfo.name || !cinfo.uuid)
          return ws.send(
            JSON.stringify({ action: "error", msg: "Invalid token" })
          );

        const word = await redis.get(`${process.env.FLY_ALLOC_ID}:word`);
        const winners =
          (await redis.lrange(`${process.env.FLY_ALLOC_ID}:winners`, 0, -1)) ||
          [];

        const guess: string = msg.msg;
        if (
          word &&
          guess?.toLowerCase() == word?.toLowerCase() &&
          !winners.includes(cinfo.uuid as string)
        ) {
          const pts = Math.max(1, 5 - winners.length);
          ws.send(
            JSON.stringify({
              action: "chat",
              msg: `You guessed the word! +${pts} pts`,
              guessed: true,
              pts: pts,
            })
          );
          wss.clients.forEach((client) => {
            client.send(
              JSON.stringify({
                action: "chat",
                msg: `${cinfo.name} guessed the word!`,
                gu: cinfo.uuid,
              })
            );
          });
          redis.lpush(
            `${process.env.FLY_ALLOC_ID}:winners`,
            cinfo.uuid as string
          );
          redis.hincrby(
            `${process.env.FLY_ALLOC_ID}:players`,
            cinfo.uuid as string,
            pts
          );
        } else if (!winners.includes(cinfo.uuid as string) && guess) {
          wss.clients.forEach((client) => {
            client.send(
              JSON.stringify({ action: "chat", name: cinfo.name, msg: guess })
            );
          });
        }

        break;
      }
    }
  });

  ws.send(JSON.stringify({ action: "confirmConnection", connected: true, special: process.env.SPECIAL == 'true' }));

  ws.on("close", async () => {
    if (uuid) {
      const pts = await redis.hget(`${process.env.FLY_ALLOC_ID}:players`, uuid);
      const nob = {};
      nob[uuid] = pts;
      await redis.hset(`${process.env.FLY_ALLOC_ID}:plpts`, nob);
      nob[uuid] = name;
      await redis.hset(`${process.env.FLY_ALLOC_ID}:plnames`, nob);
      await redis.hdel(`${process.env.FLY_ALLOC_ID}:players`, uuid);
      await redis.hdel(`${process.env.FLY_ALLOC_ID}:names`, uuid);
      const players = await redis.hlen(`${process.env.FLY_ALLOC_ID}:players`);
      if (players < 8 && process.env.PUBLIC_GAME == "true") {
        const hv = {};
        hv[process.env.FLY_ALLOC_ID] = players;
        redis.hmset(`needPlayers:${process.env.SPECIAL == 'true' ? 'special' : 'classic'}`, hv);
      }
      wss.clients.forEach((client) => {
        client.send(
          JSON.stringify({
            action: "removePlayer",
            name: name,
            players: players,
          })
        );
      });
    }
  });
});

const startCycle = async () => {
  while (true) {
    await cycle(wss, round);
    round++;
  }
};

const stream = redis.scanStream({
  match: `${process.env.FLY_ALLOC_ID}:*`,
});
stream.on("data", function (keys) {
  if (keys.length) {
    var pipeline = redis.pipeline();
    keys.forEach(function (key) {
      pipeline.del(key);
    });
    pipeline.exec();
  }
});
stream.on("end", function () {
  if (process.env.PUBLIC_GAME == "true") {
    const hv = {};
    hv[process.env.FLY_ALLOC_ID] = 0;
    redis.hmset(`needPlayers:${process.env.SPECIAL == 'true' ? 'special' : 'classic'}`, hv);
  }
  startCycle();
  console.log("Game live");
});
