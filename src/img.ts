import { GetObjectCommand } from "@aws-sdk/client-s3";
import { space } from "./space.js";

export const getImg = async (path: string) => {
  try {
    const data = await space.send(
      new GetObjectCommand({ Bucket: "bremea-cdn", Key: path })
    );
    return await data.Body?.transformToString("base64");
  } catch (err) {
    console.log("Error", err);
  }
};
