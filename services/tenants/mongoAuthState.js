// Baileys auth state stored in MongoDB per tenant, instead of files on the volume.
// Same layout as useMultiFileAuthState: one "creds" row plus one row per signal key ("<type>-<id>").
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { TenantAuthKey } from '../../database/tenantModels.js';

export const mongoAuthStore = {
  async read(tenantId, key) {
    const row = await TenantAuthKey.findOne({ tenantId, key }).lean();
    return row?.value ?? null;
  },
  async write(tenantId, key, value) {
    await TenantAuthKey.updateOne({ tenantId, key }, { $set: { value } }, { upsert: true });
  },
  async remove(tenantId, key) {
    await TenantAuthKey.deleteOne({ tenantId, key });
  },
  async clear(tenantId) {
    const { deletedCount } = await TenantAuthKey.deleteMany({ tenantId });
    return deletedCount || 0;
  }
};

export async function useMongoAuthState(tenantId, store = mongoAuthStore) {
  const id = String(tenantId);
  const readData = async key => {
    const raw = await store.read(id, key);
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
  };
  const writeData = (key, value) => store.write(id, key, JSON.stringify(value, BufferJSON.replacer));

  const creds = (await readData('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const data = {};
          await Promise.all(ids.map(async keyId => {
            let value = await readData(`${type}-${keyId}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[keyId] = value;
          }));
          return data;
        },
        async set(data) {
          const tasks = [];
          for (const type of Object.keys(data)) {
            for (const keyId of Object.keys(data[type])) {
              const value = data[type][keyId];
              const key = `${type}-${keyId}`;
              tasks.push(value ? writeData(key, value) : store.remove(id, key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData('creds', creds),
    hasSession: () => Boolean(creds.registered || creds.me?.id),
    clear: () => store.clear(id)
  };
}
