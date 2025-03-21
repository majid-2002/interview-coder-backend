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

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5000"],
  methods: ["GET", "POST"],
}));

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
          model: "openai/gpt-4o-2024-11-20",
          messages: [
            {
              role: "system",
              content:
                "You are an AI that extracts structured problem statements from images containing coding problems. The image may sometimes lack a full problem details and only include elements like class names or function names of the problem. Extract and return a JSON object with the problem details following the given structure by understanding the problem." +
                "Strictly ensure to return the response in this given format" +
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
        .replace(/```json|```/g, "")
        .trim()
    );

    return res.json({ problemInfo: extractedProblemInfo, language });
  } catch (error: any) {
    console.error("Error extracting problem:", error.message);
    return res.status(500).json({ error: "Failed to extract problem details" });
  }
});

app.post("/api/generate", async (req: any, res: any) => {
  try {
    const {
      problem_statement,
      input_format,
      test_cases,
      validation_type,
      difficulty,
      language,
      output_format,
    } = req.body;

    if (
      !problem_statement ||
      !input_format ||
      !test_cases ||
      !validation_type ||
      !difficulty ||
      !language
    ) {
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
          model: "openai/gpt-4o-2024-11-20",
          messages: [
            {
              role: "system",
              content:
                "You are programming problem solver that gives optimized and efficent solution for a problem. The code returned should be well commented and have explanations for each step",
            },
            {
              role: "user",
              content: `Solve this problem using ${language}: 
            
              Problem Statement: ${problem_statement}
            
              Input Format: ${JSON.stringify(input_format, null, 2)}
            
              Output Format: ${JSON.stringify(output_format, null, 2)}
            
              Test Cases: ${JSON.stringify(test_cases, null, 2)}
            
              Validation Type: ${validation_type}
            
              Difficulty: ${difficulty}
            
              \n\nExample Format the response strictly as:\n
              {
                "code": "<code>",
                "thoughts": [
                  "<thought 1>",
                  "<thought 2>",
                  "<thought 3>"
                ],
                "time_complexity": "<time complexity>",
                "space_complexity": "<space complexity>"
              } 
            
              The 'thoughts' field should return an array of 3 to 5 small sentences explaining the approach to solving the problem step by step. When explaining the code, say sentences in 'I' form, e.g., 'I first check if the input list is empty and return an empty list.'
            
              The 'time_complexity' and 'space_complexity' fields should return a sentence explaining the respective complexity and why the code has that complexity.
            
              Example format:
              {
                "code": "def merge(intervals): ...",
                "thoughts": [
                  "First, I need to handle the edge case where the input list is empty.",
                  "Next, I'll sort the intervals based on their start values. ...",
                ],
                "time_complexity": "O(n log n), where n is the number of intervals, due to the sorting step.",
                "space_complexity": "O(n), where n is the number of intervals, as we need to store the merged intervals in a new list."
              }
            
              Ensure that the response follows this exact JSON structure.`,
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

    const responseContent = data.choices?.[0]?.message?.content || "{}";
    const cleanedContent = responseContent.replace(/```json|```/g, "").trim();

    const solution = JSON.parse(cleanedContent);

    return res.json(solution);
  } catch (error: any) {
    console.error("Error generating solution:", error.message);
    return res.status(500).json({ error: "Failed to generate solution" });
  }
});

// app.use((err, req, res, next) => {
//   logger.error("Unhandled error:", err);
//   res.status(500).json({ error: "Internal Server Error" });
// });

// Graceful shutdown
// process.on("uncaughtException", (err) => {
//   logger.error("Uncaught Exception:", err);
//   process.exit(1);
// });

// process.on("unhandledRejection", (reason) => {
//   logger.error("Unhandled Rejection:", reason);
//   process.exit(1);
// });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
