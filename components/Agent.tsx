"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { createFeedback } from "@/lib/actions/general.action";
import { useChat } from "ai/react";
import RecordRTC, { StereoAudioRecorder } from "recordrtc";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface AgentProps {
  userName: string;
  userId: string;
  interviewId?: string;
  feedbackId?: string;
  type: "generate" | "interview";
  questions?: string[];
}

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");
  
  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecordRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const lastSpokenMessageRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Use useChat to manage conversation state and API calls
  const { messages, append, setMessages, isLoading, error } = useChat({
    api: "/api/gemini/chat",
    body: { userId, userName, type, questions },
  });

  // Handle errors
  useEffect(() => {
    if (error) {
      console.error("❌ useChat error:", error);
      alert(`Chat error: ${error.message || "Unknown error"}`);
    }
  }, [error]);

  // Play AI response using AWS Polly TTS via our API route
  const playTTS = useCallback(async (text: string) => {
    console.log("🔊 playTTS called with text:", text.substring(0, 100));
    
    if (!text || text.trim() === "") {
      console.warn("⚠️ Empty text, skipping TTS");
      return;
    }

    try {
      console.log("📡 Making TTS API request...");
      setIsSpeaking(true);

      // Stop any currently playing audio
      if (audioRef.current) {
        console.log("⏹️ Stopping previous audio");
        audioRef.current.pause();
        // audioRef.current.src = ""; // Removing this to prevent "Empty src attribute" errors
      }

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          text,
          voiceId: type === "generate" ? "Danielle" : "Matthew" // Use Danielle for prep, Matthew for interview
        }),
      });

      console.log("📡 TTS API response status:", res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("❌ TTS request failed:", res.status, errorText);
        setIsSpeaking(false);
        alert(`TTS Error: ${res.status} - ${errorText}`);
        return;
      }

      console.log("✅ TTS API success, creating audio blob...");
      const blob = await res.blob();
      // Explicitly create a Blob with the correct MIME type to ensure the browser handles it as audio
      const audioBlob = new Blob([blob], { type: "audio/mpeg" });
      console.log("📦 Blob size:", audioBlob.size, "bytes, type:", audioBlob.type);
      
      const url = URL.createObjectURL(audioBlob);
      console.log("🔗 Created object URL:", url);

      const audio = new Audio();
      audio.src = url;
      audioRef.current = audio;

      audio.onloadeddata = () => {
        console.log("✅ Audio loaded successfully, duration:", audio.duration);
      };

      audio.onplay = () => {
        console.log("▶️ Audio started playing");
      };

      audio.onended = () => {
        console.log("⏹️ Audio playback ended");
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
      };

      audio.onerror = (e) => {
        console.error("❌ Audio playback error:", e);
        console.error("Audio error details:", audio.error);
        console.error("Audio error code:", audio.error?.code);
        console.error("Audio error message:", audio.error?.message);
        setIsSpeaking(false);
        // URL.revokeObjectURL(url); // Keep URL alive for inspection if needed
        alert(`Audio playback failed. Code: ${audio.error?.code}. Check console for details.`);
      };

      console.log("▶️ Attempting to play audio...");
      await audio.play();
      console.log("✅ Audio.play() resolved successfully");
    } catch (error) {
      console.error("❌ Exception during TTS playback:", error);
      setIsSpeaking(false);
      alert(`TTS Exception: ${error}`);
    }
  }, []);

  // Trigger TTS when new assistant message arrives and loading completes
  useEffect(() => {
    console.log("📊 Messages/Loading changed - length:", messages.length, "isLoading:", isLoading);
    
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      console.log("📝 Last message - role:", last.role, "content length:", last.content?.length);
      
      if (last.role === 'assistant' && last.content) {
        setLastMessage(last.content);
        console.log("✏️ UI updated with assistant message");
        
        // Trigger TTS when loading completes and haven't spoken this message
        if (!isLoading && last.content !== lastSpokenMessageRef.current) {
          console.log("🔊 Loading complete, triggering TTS");
          lastSpokenMessageRef.current = last.content;
          playTTS(last.content);
        }
      }
    }
  }, [messages, isLoading, playTTS]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      handleDisconnect();
    };
  }, []);

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);
    console.log("📞 Starting call...");

    try {
      // 1. Get AssemblyAI Token
      const response = await fetch("/api/assemblyai/token");
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      const token = data.token;
      console.log("✅ AssemblyAI token obtained");

      // 2. Initialize WebSocket
      const socket = new WebSocket(
        `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}`
      );
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("✅ AssemblyAI WebSocket opened");
        setCallStatus(CallStatus.ACTIVE);
        
        // Start recording after socket is open
        startRecording(socket);
        
        // If it's the start of the conversation and no messages exist, trigger the initial greeting
        if (messages.length === 0) {
            console.log("👋 Sending initial greeting");
            append({ role: "user", content: "Hello" });
        }
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.message_type === "FinalTranscript") {
           console.log("🎤 Final Transcript:", message.text);
           if (message.text.trim() !== "") {
             // Accumulate text
             accumulatedTextRef.current += " " + message.text;

             // Reset silence timer
             if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
             
             // Wait 3 seconds of silence before sending to AI to allow for pauses
             silenceTimeoutRef.current = setTimeout(() => {
                const fullText = accumulatedTextRef.current.trim();
                if (fullText) {
                    console.log("📤 Sending to Gemini:", fullText);
                    append({ role: "user", content: fullText });
                    accumulatedTextRef.current = "";
                }
             }, 3000);
           }
        }
      };

      socket.onerror = (error) => {
        console.error("❌ AssemblyAI WebSocket error:", error);
      };
      
      socket.onclose = () => {
          console.log("🔌 AssemblyAI WebSocket closed");
          if (callStatus === CallStatus.ACTIVE) {
              handleDisconnect();
          }
      };

    } catch (error) {
      console.error("❌ Error starting call:", error);
      setCallStatus(CallStatus.INACTIVE);
      alert("Error starting call. Please check console.");
    }
  };

  const startRecording = async (socket: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("🎤 Microphone access granted");

      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/webm;codecs=pcm",
        recorderType: StereoAudioRecorder,
        timeSlice: 250,
        desiredSampRate: 16000,
        numberOfAudioChannels: 1,
        bufferSize: 4096,
        audioBitsPerSecond: 128000,
        ondataavailable: (blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64data = (reader.result as string).split(",")[1];
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ audio_data: base64data }));
            }
          };
          reader.readAsDataURL(blob);
        },
      });

      recorder.startRecording();
      recorderRef.current = recorder;
      console.log("🔴 Recording started");
    } catch (err) {
      console.error("❌ Error accessing microphone:", err);
    }
  };

  const handleDisconnect = () => {
    console.log("🔚 Disconnecting...");
    
    // Only perform navigation logic if the call was actually active
    if (callStatus === CallStatus.ACTIVE || callStatus === CallStatus.CONNECTING) {
       if (type !== "generate" && messages.length > 0) {
         handleGenerateFeedback();
       } else if (type === "generate") {
          router.push("/");
       }
    }

    setCallStatus(CallStatus.FINISHED);
    setIsSpeaking(false);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (recorderRef.current) {
      recorderRef.current.stopRecording(() => {});
      recorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handleGenerateFeedback = async () => {
      const conversation = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({ role: m.role, content: m.content }));
      
      const { success, feedbackId: id } = await createFeedback({
        interviewId: interviewId!,
        userId: userId!,
        transcript: conversation as any,
        feedbackId,
      });

      if (success && id) {
        router.push(`/interview/${interviewId}/feedback`);
      } else {
        router.push("/");
      }
  };

  return (
    <>
      <div className="call-view">
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button className="relative btn-call" onClick={() => handleCall()}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {callStatus === "INACTIVE" || callStatus === "FINISHED"
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;
