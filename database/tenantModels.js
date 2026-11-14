// Models for the business accounts (tenants): each tenant has its own WhatsApp number, auth keys and customers.
// Every collection is keyed by tenantId so one account never reads another's data.
import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 32 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  passwordHash: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  phone: { type: String, default: '' },
  lastConnectedAt: { type: Date, default: null }
}, { timestamps: true, minimize: false });

const tenantAuthKeySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  key: { type: String, required: true },
  value: { type: String, required: true }
}, { timestamps: true });
tenantAuthKeySchema.index({ tenantId: 1, key: 1 }, { unique: true });

const historySchema = new mongoose.Schema({
  role: { type: String, enum: ['customer', 'agent', 'owner'], required: true },
  text: { type: String, maxlength: 2000 },
  at: { type: Date, default: Date.now }
}, { _id: false });

const tenantContactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  jid: { type: String, required: true },
  phone: { type: String, default: '' },
  pushName: { type: String, default: '', maxlength: 120 },
  arabicName: { type: String, default: '', maxlength: 60 },
  history: { type: [historySchema], default: [] },
  pausedUntil: { type: Date, default: null },
  lastMessageAt: { type: Date, default: null },
  handoffAt: { type: Date, default: null },
  conversationStartedAt: { type: Date, default: null },
  summarySentAt: { type: Date, default: null },
  handoffSummary: { type: String, default: '', maxlength: 600 },
  messageCount: { type: Number, default: 0 }
}, { timestamps: true });
tenantContactSchema.index({ tenantId: 1, jid: 1 }, { unique: true });
tenantContactSchema.index({ tenantId: 1, lastMessageAt: -1 });

export const Tenant = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
export const TenantAuthKey = mongoose.models.TenantAuthKey || mongoose.model('TenantAuthKey', tenantAuthKeySchema);
export const TenantContact = mongoose.models.TenantContact || mongoose.model('TenantContact', tenantContactSchema);
