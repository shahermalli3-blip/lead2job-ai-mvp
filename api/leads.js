export default function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "Lead2Job AI API is working"
    });
  }

  if (req.method === "POST") {
    const { name, service, value, status } = req.body || {};

    if (!name || !service || typeof value !== "number") {
      return res.status(400).json({
        success: false,
        error: "Invalid lead payload"
      });
    }

    const lead = {
      id: `lead_${Date.now()}`,
      name,
      service,
      value,
      status: status || "new",
      receivedAt: new Date().toISOString()
    };

    return res.status(200).json({
      success: true,
      message: "Lead received",
      lead
    });
  }

  return res.status(405).json({
    success: false,
    error: "Method not allowed"
  });
}
