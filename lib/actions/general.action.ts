"use server";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import OpenAI from "openai"; // Standard OpenAI client for direct calls

import { db } from "@/firebase/admin";
import { feedbackSchema } from "@/constants";
import { getRandomInterviewCover } from "@/lib/utils";

// Standard OpenAI client for robust JSON generation
const openaiDirect = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AI SDK wrapper (if needed for other parts, but we'll use direct client for generation)
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateInterview(params: {
  role: string;
  level: string;
  techstack: string;
  type: string;
  amount: number | string;
  userid: string;
}) {
  const { role, level, techstack, type, amount, userid } = params;

  try {
    // Using direct OpenAI client to force JSON object mode
    const response = await openaiDirect.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that generates interview questions."
        },
        {
          role: "user",
          content: `Prepare questions for a job interview.
            The job role is ${role}.
            The job experience level is ${level}.
            The tech stack used in the job is: ${techstack}.
            The focus between behavioural and technical questions should lean towards: ${type}.
            The amount of questions required is: ${amount}.
            
            Return the questions as a JSON object with a single key "questions" containing an array of strings.
            Example: { "questions": ["Question 1", "Question 2"] }
            
            The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters.
          `
        }
      ],
      response_format: { type: "json_object" }, // FORCE JSON
    });

    const text = response.choices[0].message.content || "{}";
    let parsedQuestions: string[] = [];

    try {
      const parsed = JSON.parse(text);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        parsedQuestions = parsed.questions;
      } else {
        throw new Error("JSON structure invalid: missing 'questions' array");
      }
    } catch (e) {
      console.error("Failed to parse interview questions JSON:", text);
      throw new Error("Failed to parse interview questions: " + e);
    }

    const interview = {
      role: role,
      type: type,
      level: level,
      techstack: techstack.split(","),
      questions: parsedQuestions,
      userId: userid,
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection("interviews").add(interview);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("Error generating interview:", error);
    return { success: false, error };
  }
}

export async function createFeedback(params: CreateFeedbackParams) {
  const { interviewId, userId, transcript, feedbackId } = params;

  try {
    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    // Using direct OpenAI client for feedback generation too
    const response = await openaiDirect.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories."
        },
        {
          role: "user",
          content: `
            Transcript:
            ${formattedTranscript}

            Please score the candidate from 0 to 100 in the following areas. Do not add categories other than the ones provided.
            
            Output the result as a strict JSON object matching this structure:
            {
              "totalScore": number,
              "categoryScores": [
                {
                  "name": "Communication Skills",
                  "score": number,
                  "comment": "Specific feedback explaining the score"
                },
                {
                  "name": "Technical Knowledge",
                  "score": number,
                  "comment": "Specific feedback explaining the score"
                },
                {
                  "name": "Problem-Solving",
                  "score": number,
                  "comment": "Specific feedback explaining the score"
                },
                {
                  "name": "Cultural & Role Fit",
                  "score": number,
                  "comment": "Specific feedback explaining the score"
                },
                {
                  "name": "Confidence & Clarity",
                  "score": number,
                  "comment": "Specific feedback explaining the score"
                }
              ],
              "strengths": string[],
              "areasForImprovement": string[],
              "finalAssessment": string
            }
            `
        }
      ],
      response_format: { type: "json_object" }, // FORCE JSON
    });

    const text = response.choices[0].message.content || "{}";
    let object: any;

    try {
      object = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse feedback JSON:", text);
      throw new Error("Failed to parse feedback JSON");
    }

    const feedback = {
      interviewId: interviewId,
      userId: userId,
      totalScore: object.totalScore,
      categoryScores: object.categoryScores,
      strengths: object.strengths,
      areasForImprovement: object.areasForImprovement,
      finalAssessment: object.finalAssessment,
      createdAt: new Date().toISOString(),
    };

    let feedbackRef;

    if (feedbackId) {
      feedbackRef = db.collection("feedback").doc(feedbackId);
    } else {
      feedbackRef = db.collection("feedback").doc();
    }

    await feedbackRef.set(feedback);

    return { success: true, feedbackId: feedbackRef.id };
  } catch (error) {
    console.error("Error saving feedback:", error);
    return { success: false };
  }
}

export async function getInterviewById(id: string): Promise<Interview | null> {
  const interview = await db.collection("interviews").doc(id).get();

  return interview.data() as Interview | null;
}

export async function getFeedbackByInterviewId(
  params: GetFeedbackByInterviewIdParams
): Promise<Feedback | null> {
  const { interviewId, userId } = params;

  const querySnapshot = await db
    .collection("feedback")
    .where("interviewId", "==", interviewId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (querySnapshot.empty) return null;

  const feedbackDoc = querySnapshot.docs[0];
  return { id: feedbackDoc.id, ...feedbackDoc.data() } as Feedback;
}

export async function getLatestInterviews(
  params: GetLatestInterviewsParams
): Promise<Interview[] | null> {
  const { userId, limit = 20 } = params;

  let query = db
    .collection("interviews")
    .orderBy("createdAt", "desc")
    .where("finalized", "==", true);

  // Only add userId filter if userId is defined
  if (userId) {
    query = query.where("userId", "!=", userId);
  }

  const interviews = await query.limit(limit).get();

  return interviews.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}

export async function getInterviewsByUserId(
  userId: string | undefined
): Promise<Interview[] | null> {
  // Return empty array if userId is undefined
  if (!userId) {
    return [];
  }

  const interviews = await db
    .collection("interviews")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return interviews.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}
