import express from "express";
import { confirmLead } from "../../services/crmService.js";
import { generatePackForLead } from "../../services/packGenerator.js";
import { saveValidatedOffer } from "../../services/offerValidator.js";

const router = express.Router();

router.get("/:leadId", async (req, res) => {
  try {
    const { leadId } = req.params;

    const lead = await confirmLead(leadId);

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const pack = await generatePackForLead(lead);
    const validation = saveValidatedOffer(pack);

    return res.json({
      success: true,
      message: "Lead confirmed",
      pack,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        warnings: validation.warnings,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;