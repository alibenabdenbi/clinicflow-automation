exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug;

  const clients = {
    "museumdental": {
      clinicName: "Museum Dental",
      stage: "payment",
      paymentReceived: false,
      csvReceived: false,
      campaignBuilt: false,
      systemLive: false,
      nextAction: "Awaiting payment to begin setup",
      mohamedPhone: "438-544-0442",
      mohamedEmail: "contact@clinicflowautomation.com"
    }
  };

  const client = clients[slug];
  if (!client) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(client)
  };
};
