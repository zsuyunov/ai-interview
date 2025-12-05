import { NextResponse } from "next/server";
import { AssemblyAI } from "assemblyai";

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing AssemblyAI API Key" }, { status: 500 });
  }

  const client = new AssemblyAI({ apiKey });
  
  try {
    const token = await client.realtime.createTemporaryToken({ expires_in: 3600 });
    return NextResponse.json({ token });
  } catch (error) {
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}

