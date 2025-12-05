import { NextResponse } from "next/server";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

// AWS Credentials from environment variables
const AWS_ACCESS_KEY_ID = process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.NEXT_PUBLIC_AWS_SECREAT_KEY; // User specified spelling
const AWS_REGION = "us-east-1"; // Default region, can be changed

export async function POST(request: Request) {
  console.log("🎙️ TTS API called");
  console.log("AWS_ACCESS_KEY_ID exists:", !!AWS_ACCESS_KEY_ID);
  console.log("AWS_SECRET_ACCESS_KEY exists:", !!AWS_SECRET_ACCESS_KEY);

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error("❌ Missing AWS credentials");
    return NextResponse.json(
      { error: "Missing AWS Credentials in environment variables. Check NEXT_PUBLIC_AWS_ACCESS_KEY_ID and NEXT_PUBLIC_AWS_SECREAT_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { text, voiceId } = body;
    console.log("📝 Text to synthesize:", text?.substring(0, 100));
    console.log("🗣️ Requested VoiceId:", voiceId);

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.error("❌ Invalid text provided");
      return NextResponse.json(
        { error: "Text is required for TTS" },
        { status: 400 }
      );
    }

    console.log("🔧 Creating Polly client...");
    const client = new PollyClient({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });

    console.log("📡 Sending SynthesizeSpeech command to AWS Polly...");
    const command = new SynthesizeSpeechCommand({
      Engine: "neural", // Use neural engine for better quality
      OutputFormat: "mp3",
      Text: text,
      VoiceId: voiceId || "Danielle", // Use requested voice or default to Danielle
    });

    const response = await client.send(command);
    console.log("✅ AWS Polly response received");

    if (!response.AudioStream) {
      console.error("❌ No audio stream in response");
      throw new Error("No audio stream returned from AWS Polly");
    }

    console.log("🔄 Converting audio stream to buffer...");
    const audioArrayBuffer = await response.AudioStream.transformToByteArray();
    const audioBuffer = Buffer.from(audioArrayBuffer);
    console.log("✅ Audio buffer created, size:", audioBuffer.byteLength, "bytes");

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
      },
    });
  } catch (error: any) {
    console.error("❌ AWS Polly TTS error:", error);
    console.error("Error details:", {
      message: error?.message,
      code: error?.$metadata?.httpStatusCode || error?.code,
      requestId: error?.$metadata?.requestId,
    });
    
    return NextResponse.json(
      { 
        error: "Failed to generate audio with AWS Polly", 
        details: error?.message || "Unknown error",
        code: error?.code || "UNKNOWN"
      },
      { status: 500 }
    );
  }
}
