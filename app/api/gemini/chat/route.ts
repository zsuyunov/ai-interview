import { OpenAIStream, StreamingTextResponse } from "ai";
import OpenAI from "openai";
import { generateInterview } from "@/lib/actions/general.action";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages, userId, userName, type, questions } = await req.json();
    
    console.log("🎯 OpenAI API called - type:", type, "userName:", userName);
    console.log("📨 Messages count:", messages?.length);

    // Check if tool has already been called in the history to prevent duplicates
    const hasToolCall = messages.some((m: any) => 
        m.role === 'assistant' && 
        m.tool_calls && 
        m.tool_calls.some((tc: any) => tc.function.name === 'generate_interview')
    );

    // Force disable tools if we've already generated an interview
    const shouldEnableTools = type === "generate" && !hasToolCall;

    let systemPrompt = "";

    if (type === "generate") {
      systemPrompt = `You are a helpful assistant designed to conduct a mock interview setup.
      
      Goal: Collect 5 key pieces of information from the user efficiently to generate an interview.
      User Name: ${userName}
      
      Information needed:
      1. Role (e.g. Frontend Developer)
      2. Level (e.g. Junior, Senior)
      3. Tech Stack (e.g. React, Node.js)
      4. Focus (Behavioural or Technical)
      5. Question Count (e.g. 5)

      Instructions:
      - Start by introducing yourself briefly and asking the first question.
      - ask ONE question at a time.
      - DO NOT repeat what the user just said unless clarifying ambiguity.
      - DO NOT verify previous answers constantly. Move to the next question immediately.
      - Be concise, professional, and quick.
      - Once all 5 items are collected, IMMEDIATELY call the 'generate_interview' tool.
      - Call the 'generate_interview' tool ONLY ONCE. After calling it, simply confirm to the user and DO NOT call it again.
      - After the tool call, confirm success briefly.
      `;
    } else {
      const formattedQuestions = questions ? questions.join("\n") : "";
      systemPrompt = `You are a professional interviewer.
      
      Candidate: ${userName}
      Task: Conduct a voice interview based on these questions:
      ${formattedQuestions}

      Instructions:
      - Ask ONE question at a time from the list.
      - Listen to the answer, acknowledge it briefly (e.g., "Understood", "Good point"), and move to the next question.
      - Keep responses SHORT (1-2 sentences max) to maintain a natural conversation flow.
      - Do not ramble or give long feedback during the interview.
      - If the candidate asks for clarification, provide it concisely.
      - At the end, thank them and sign off professionally.
      `;
    }

    // Define tools for OpenAI SDK
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "generate_interview",
          description: "Generates the interview once all information is collected.",
          parameters: {
            type: "object",
            properties: {
              role: { type: "string", description: "The job role (e.g. Frontend Developer)" },
              level: { type: "string", description: "The job level (e.g. Junior, Senior)" },
              techstack: { type: "string", description: "The tech stack (e.g. React, Node.js)" },
              focus: { type: "string", description: "The focus of questions (Behavioural or Technical)" },
              amount: { type: "string", description: "The number of questions (e.g. '5')" },
            },
            required: ["role", "level", "techstack", "focus", "amount"],
          },
        },
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      stream: true,
      tools: shouldEnableTools ? tools : undefined,
    });

    console.log("✅ OpenAI chat completion created successfully");
    console.log("🔄 Returning OpenAIStream wrapped in StreamingTextResponse");

    const stream = OpenAIStream(response as any, {
      experimental_onToolCall: async (toolCallPayload: any, appendToolCallMessage: any) => {
        console.log("🛠️ Tool Call Payload:", JSON.stringify(toolCallPayload));

        if (toolCallPayload.tools) {
            for (const toolCall of toolCallPayload.tools) {
                // Handle 'func' vs 'function' property difference in some AI SDK versions
                const fn = toolCall.func || toolCall.function;
                if (!fn) continue;

                if (fn.name === 'generate_interview') {
                    let params;
                    try {
                        // Check if arguments is already an object (parsed) or string
                        if (typeof fn.arguments === 'object' && fn.arguments !== null) {
                            params = fn.arguments;
                        } else {
                            params = JSON.parse(fn.arguments);
                        }
                        console.log("🛠️ Tool Call: generate_interview", params);
                    } catch (e) {
                        console.error("❌ JSON Parse Error in tool arguments:", e);
                        console.error("Raw arguments:", fn.arguments);
                         return "Error: Invalid tool arguments generated by AI.";
                    }
                    
                    const { role, level, techstack, focus, amount } = params;
                    const result = await generateInterview({ 
                        role, 
                        level, 
                        techstack, 
                        type: focus, 
                        amount, 
                        userid: userId 
                    });
                    
                    let output = "Error generating interview.";
                    if (result.success) {
                        output = "Interview generated successfully.";
                    }
                    
                    const newMessages = appendToolCallMessage({
                        tool_call_id: toolCall.id,
                        function_name: fn.name,
                        tool_call_result: output,
                    });
                    
                    // For the recursive call, we definitely disable tools to prevent loops
                    const newResponse = await openai.chat.completions.create({
                        model: "gpt-4o",
                        stream: true,
                        messages: [
                            { role: "system", content: systemPrompt },
                            ...messages,
                            ...newMessages,
                        ],
                        tools: undefined // Disable tools in follow-up to prevent loops
                    });

                    return newResponse as any;
                }
            }
        }
      },
    });

    return new StreamingTextResponse(stream);

  } catch (error: any) {
    console.error("❌ OpenAI API Error:", error);
    console.error("Error details:", error.message, error.stack);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to process chat request",
        details: error.toString()
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
