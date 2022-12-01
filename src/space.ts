import { S3 } from "@aws-sdk/client-s3";
import { config } from "dotenv";
config();

const space = new S3({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  forcePathStyle: false,
  region: "nyc3",
  credentials: {
    accessKeyId: process.env.S3_ID as string,
    secretAccessKey: process.env.S3_KEY as string,
  },
});

export { space };
