'use strict';

function normPhone(p) {
    return (p || '').replace(/\D/g, '');
}

function normDomain(url) {
    try {
        const host = new URL(url).hostname;
        return host.replace(/^www\./, '');
    } catch { return ''; }
}

function normName(name, city) {
    const n = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const c = (city || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return n + '|' + c;
}

function dedupe(records) {
    const seenPhone  = new Map();
    const seenDomain = new Map();
    const seenName   = new Map();
    const result     = [];

    for (const rec of records) {
        const phone  = normPhone(rec.contact?.phone);
        const domain = normDomain(rec.contact?.website);
        const name   = normName(rec.company?.name, rec.contact?.address?.city);

        if (phone  && seenPhone.has(phone))   continue;
        if (domain && seenDomain.has(domain)) continue;
        if (name   && seenName.has(name))     continue;

        if (phone)  seenPhone.set(phone, true);
        if (domain) seenDomain.set(domain, true);
        if (name)   seenName.set(name, true);

        result.push(rec);
    }
    return result;
}

module.exports = { dedupe };