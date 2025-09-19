import Ably from "ably";

export async function handler(event, context) {
  // 只允許 GET 請求
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // 確保 ABLY_API_KEY 存在
    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) {
      console.error("Missing ABLY_API_KEY environment variable");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Internal server error" }),
      };
    }

    const client = new Ably.Rest(apiKey);
    const tokenRequest = await client.auth.createTokenRequest({ clientId: "vue-client" });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: JSON.stringify(tokenRequest),
    };
  } catch (error) {
    console.error("Error creating token request:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

// 處理 OPTIONS 請求（CORS preflight）
export async function handlerForOptions(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }
  return await handler(event, context);
}
