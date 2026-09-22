import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['64:ff9b::',96],['2002::',16]]) blocked.addSubnet(address,prefix,'ipv6');
export function isPublicAddress(address) {
  const family = isIP(address);
  return Boolean(family) && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('استخدم رابط HTTPS عام بدون بيانات دخول أو منفذ مخصص');
  const host = url.hostname.replace(/^\[|\]$/g,'');
  if (host === 'localhost' || host.endsWith('.local') || (isIP(host) && !isPublicAddress(host))) throw new Error('العناوين الداخلية غير مسموحة');
  return url;
}
export async function publicHttpsAgent(endpoint) {
  const url = validateEndpoint(endpoint);
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(row => !isPublicAddress(row.address))) throw new Error('العناوين الداخلية غير مسموحة');
  // Pin the vetted resolution so DNS cannot change between validation and connection.
  return new https.Agent({ lookup: (_host, options, callback) => {
    const candidates = options.family ? addresses.filter(row => row.family === options.family) : addresses;
    if (!candidates.length) return callback(new Error('Address family unavailable'));
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  } });
}
