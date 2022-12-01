import Redis from "ioredis";
import { config } from "dotenv";
config();

const redis = new Redis();

export default redis;
