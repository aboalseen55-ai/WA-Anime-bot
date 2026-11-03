import mongoose from "mongoose";

// Survives restarts so a redeploy does not repeat every open alert.
const opsWatchStateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  alerts: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastSummaryDate: {
    type: String,
    default: ""
  }
}, { minimize: false });

export default mongoose.models.OpsWatchState || mongoose.model("OpsWatchState", opsWatchStateSchema);
