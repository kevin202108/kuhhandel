const Ably = require("ably");

export function handler(event, context, callback) {
  // 只允許 GET 請求
  if (event.httpMethod !== "GET") {
    return callback(null, {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    });
  }

  // 確保 ABLY_API_KEY 存在
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    console.error("Missing ABLY_API_KEY environment variable");
    return callback(null, {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    });
  }

  try {
    const client = new Ably.Rest(apiKey);

    // 使用 callback 版本的 createTokenRequest
    client.auth.createTokenRequest({ clientId: "vue-client" }, (err, tokenRequest) => {
      if (err) {
        console.error("Error creating token request:", err);
        return callback(null, {
          statusCode: 500,
          body: JSON.stringify({ error: "Internal server error" }),
        });
      }

      callback(null, {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
        body: JSON.stringify(tokenRequest),
      });
    });
  } catch (error) {
    console.error("Error creating token request:", error);
    callback(null, {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    });
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
