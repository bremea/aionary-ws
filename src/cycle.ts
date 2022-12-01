import * as fs from "fs";
import { dirname } from "path";
import { getImg } from "./img.js";
import { WebSocketServer } from "ws";
import redis from "./redis.js";
import centra from "centra";

const wait = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const cycle = async (wss: WebSocketServer, round: number) => {
  let players = await redis.hlen(`${process.env.FLY_ALLOC_ID}:players`);
  redis.set(`${process.env.FLY_ALLOC_ID}:state`, 1);
  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        action: "gameState",
        state: 1,
        round: round,
        players: players,
      })
    );
    client.send(
      JSON.stringify({
        action: "word",
        word: "",
      })
    );
  });
  await wait(3 * 1000);
  const prompts = fs
    .readFileSync(
      process.cwd() +
        `/${process.env.SPECIAL == "true" ? "special" : "prompts"}.txt`
    )
    .toString()
    .split("\n");
  const word = prompts[Math.floor(Math.random() * prompts.length)];
  const maxHints = Math.min(word.length - 2, 6);
  redis.set(`${process.env.FLY_ALLOC_ID}:word`, word);
  players = await redis.hlen(`${process.env.FLY_ALLOC_ID}:players`);
  redis.set(`${process.env.FLY_ALLOC_ID}:state`, 2);
  let genBlank = new Array(word.length + 1).join(" ");
  for (let og = 0; og < word.length; og++) {
    if (word.charAt(og) == " ") {
      genBlank = genBlank.substring(0, og) + "_" + genBlank.substring(og + 1);
    }
  }
  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        action: "gameState",
        state: 2,
        round: round,
        players: players,
      })
    );
    client.send(
      JSON.stringify({
        action: "word",
        word: genBlank.toUpperCase(),
      })
    );
  });
  let chint = maxHints - 7;
  for (let i = 0; i <= 14; i++) {
    const img = await getImg(
      `aionary/${process.env.SPECIAL == "true" ? "special/" : ""}img_${
        prompts.indexOf(word) + 1
      }_step_${i}.png`
    );
    let wDidc = false;
    if (i % 2 === 0) {
      if (chint > 0 && chint <= maxHints) {
        let spchar;
        do {
          spchar = Math.floor(Math.random() * genBlank.length);
        } while (genBlank.charAt(spchar) !== " ");
        genBlank =
          genBlank.substring(0, spchar) +
          word.charAt(spchar) +
          genBlank.substring(spchar + 1);
        wDidc = true;
      }
      chint++;
    }
    wss.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          action: "img",
          img: `data:image/png;base64,${img}`,
          prc: Math.trunc((i / 15) * 100),
        })
      );
      if (wDidc) {
        client.send(
          JSON.stringify({
            action: "word",
            word: genBlank.toUpperCase(),
          })
        );
      }
    });
    await wait(1300 * (i / 5));
  }
  redis.set(`${process.env.FLY_ALLOC_ID}:state`, 3);
  const winners =
    (await redis.lrange(`${process.env.FLY_ALLOC_ID}:winners`, 0, -1)) || [];
  const lb = (await redis.hgetall(
    `${process.env.FLY_ALLOC_ID}:players`
  )) as unknown as Record<string, number>;
  redis.del(`${process.env.FLY_ALLOC_ID}:winners`);
  redis.del(`${process.env.FLY_ALLOC_ID}:word`);

  const names = await redis.hgetall(`${process.env.FLY_ALLOC_ID}:names`);
  const lbSort = Object.keys(lb)
    .sort((a, b) => lb[a] - lb[b])
    .reverse();
  const lbFin = {};
  const winnerNames = [];

  winners.reverse();

  for (let o = 0; o < winners.length; o++) {
    winnerNames.push(names[winners[o]]);
  }
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
        action: "word",
        word: word.toUpperCase(),
      })
    );
    client.send(
      JSON.stringify({
        action: "chat",
        msg: `The word was ${word}!`,
      })
    );
    client.send(
      JSON.stringify({
        action: "winners",
        winners: winnerNames,
        winnersUUID: winners,
      })
    );
    client.send(
      JSON.stringify({
        action: "leaderboard",
        leaderboard: lbFin,
      })
    );
    client.send(
      JSON.stringify({
        action: "gameState",
        state: 3,
        round: round,
        players: lb.length,
      })
    );
  });
  await wait(10 * 1000);

  if (round > 5 && players == 0) {
    if (process.env.PUBLIC_GAME == "true") {
      redis.hdel(`needPlayers:${process.env.SPECIAL == 'true' ? 'special' : 'classic'}`, process.env.FLY_ALLOC_ID);
    }
    const kms = centra(
      `https://ws.aionary.com/kms/${process.env.FLY_ALLOC_ID}`,
      "POST"
    );
    kms.header("Authorization", `Bearer ${process.env.JWT}`);
    kms.header("Content-Type", "application/json");
    kms.body(JSON.stringify({ finalWords: "goodbye o7" }));
    await kms.send();
  }
};

export default cycle;
