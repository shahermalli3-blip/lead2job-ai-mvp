export default function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "Lead2Job AI API is working"
    });
  }

  if (req.method === "POST") {
    const lead = req.body;

    return res.status(200).json({
      success: true,
      message: "Lead received",
      lead: lead
    });
  }

  return res.status(405).json({
    error: "Method not allowed"
  });
}
