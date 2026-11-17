import ReactGA from 'react-ga4';

const lastHostByTab = new Map();
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

const siteFrom = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || IP_HOST.test(host) || host.endsWith('.local')) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
};

export const reportProxySite = (tabId, realUrl, engine) => {
  const site = siteFrom(realUrl);
  if (!site || lastHostByTab.get(tabId) === site) return;
  lastHostByTab.set(tabId, site);
  try {
    ReactGA.event('proxy_site', { site, engine });
  } catch {
    return;
  }
};

export const forgetProxyTab = (tabId) => lastHostByTab.delete(tabId);
