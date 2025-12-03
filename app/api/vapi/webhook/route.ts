// VAPI Webhook Endpoint
// Receives and processes webhook events from VAPI during phone calls
export async function POST(request: Request) {
  try {
    // 1. Validate Bearer token authentication
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.VAPI_AUTH_TOKEN;

    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      console.log("⚠️ Unauthorized VAPI webhook attempt");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json();

    // 3. Log incoming webhook data for debugging
    console.log("📞 === VAPI Webhook Received ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Headers:", Object.fromEntries(request.headers.entries()));
    console.log("Body:", JSON.stringify(body, null, 2));

    // 4. Extract webhook data
    const { message, call, type, timestamp } = body;

    // 5. Handle different webhook event types
    switch (type) {
      case "call.started":
        console.log("✅ Call started - ID:", call?.id);
        // Add your custom logic for call start
        break;

      case "call.ended":
        console.log("🔚 Call ended - ID:", call?.id);
        // Add your custom logic for call end
        break;

      case "message":
        console.log("💬 Message received:", message);
        // Add your custom logic for messages
        break;

      case "transcript":
        console.log("📝 Transcript update:", body);
        // Add your custom logic for transcripts
        break;

      default:
        console.log("❓ Unknown webhook type:", type);
    }

    // 6. Send success response
    return Response.json(
      {
        success: true,
        received: true,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ Error processing VAPI webhook:", error);
    return Response.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

