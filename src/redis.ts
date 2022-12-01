import Redis from "ioredis";
import { config } from "dotenv";
config();

const redis = new Redis(process.env.REDIS, { family: 6 });

export default redis;
