import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

app.use(cors());

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

export interface ProblemStatementData {
  problem_statement: string;
  input_format: {
    description: string;
    parameters: any[];
  };
  output_format: {
    description: string;
    type: string;
    subtype: string;
  };
  complexity: {
    time: string;
    space: string;
  };
  test_cases: any[];
  validation_type: string;
  difficulty: string;
}

async function compressImage(base64String) {
  const buffer = Buffer.from(base64String, "base64");
  const compressedBuffer = await sharp(buffer).jpeg({ quality: 86 }).toBuffer();

  return compressedBuffer.toString("base64");
}

app.post("/api/extract", async (req: any, res: any) => {
  try {
    console.log("Extracting problem info from image...");
    const { imageDataList, language } = req.body;

    if (!imageDataList || imageDataList.length === 0) {
      return res.status(400).json({ error: "No image data provided" });
    }

    const compressedImages = await Promise.all(
      imageDataList.map((base64Image) => compressImage(base64Image))
    );

    const dir = path.join(__dirname, "images");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    compressedImages.forEach((image, index) => {
      const filePath = path.join(dir, `image_${index}_${Date.now()}.jpeg`);
      fs.writeFileSync(filePath, image, "base64");
    });

    const openAiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions", // I used openrouter.ai you can use api.openai.com instead of openrouter.ai both are same
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4.5-preview",
          messages: [
            {
              role: "system",
              content:
                "You are an AI that extracts structured problem statements from images containing coding problems. The image may sometimes lack a full problem name and only include elements like class names or function names. Extract and return a JSON object with the problem details following the given structure." +
                JSON.stringify({
                  problem_statement: "string",
                  input_format: {
                    description: "string",
                    parameters: [],
                  },
                  output_format: {
                    description: "string",
                    type: "string",
                    subtype: "string",
                  },
                  complexity: {
                    time: "string",
                    space: "string",
                  },
                  test_cases: [],
                  validation_type: "string",
                  difficulty: "string",
                }),
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract problem statement from this image:",
                },
                ...compressedImages.map((base64Image: any) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`,
                  },
                })),
              ],
            },
          ],
        }),
      }
    );

    const openAiResponseJson = await openAiResponse.json();
    const extractedProblemInfo: ProblemStatementData = JSON.parse(
      openAiResponseJson.choices[0].message.content
    );

    console.log("Extracted problem info:", extractedProblemInfo);

    return res.json({ problemInfo: extractedProblemInfo, language });
  } catch (error: any) {
    console.error("Error extracting problem:", error.message);
    return res.status(500).json({ error: "Failed to extract problem details" });
  }
});

app.post("/api/generate", async (req: any, res: any) => {
  try {
    const { problemInfo, language } = req.body;

    if (!problemInfo) {
      return res.status(400).json({ error: "Problem info is required" });
    }

    const openAiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4.5-preview",
          messages: [
            {
              role: "system",
              content:
                "Solve the given programming problem efficiently and return JSON in the specified format.",
            },
            {
              role: "user",
              content: `Solve this problem using ${language}: ${problemInfo}.\n\n
                        Format the response strictly as:\n
                        {
                          "code": "<code>",
                          "thoughts": ["<thought 1>", "<thought 2>", "<thought 3>"],
                          "time_complexity": "<time complexity>",
                          "space_complexity": "<space complexity>"
                        } 
                          
                        the thoughts should returns an array of setences of thoughts on solving the problem in 3 to 5 steps.
                        the time_complexity and space_compexity should return a sentence of the complexity and why do we have that complexity in the code.

                        eg: O(n log n), where n is the number of intervals, due to sorting step.
                        `,
            },
          ],
        }),
      }
    );

    if (!openAiResponse.ok) {
      throw new Error(
        `OpenAI API request failed with status ${openAiResponse.status}`
      );
    }

    const data = await openAiResponse.json();
    const solution = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    console.log("Generated solution:", solution);

    return res.json(solution);
  } catch (error: any) {
    console.error("Error generating solution:", error.message);
    return res.status(500).json({ error: "Failed to generate solution" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
