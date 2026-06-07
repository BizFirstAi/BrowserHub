'use strict';

function blankRecord() {
    return {
        recordType: 'BusinessLead',
        source: '',
        extractedAt: '',
        company: { name: '', category: '' },
        contact: {
            phone: '',
            website: '',
            address: { street: '', city: '', state: '', zip: '', country: '' },
        },
        signals: { rating: null, reviewCount: null },
        meta: { sourceUrl: '', runId: '' },
    };
}

function setPath(obj, dotPath, value) {
    if (value === undefined || value === null || value === '') return;
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function normalize(rawRecords, outputMap, sourceId) {
    const now = new Date().toISOString();
    return rawRecords.map(raw => {
        const rec = blankRecord();
        rec.source = sourceId;
        rec.extractedAt = now;
        for (const [destPath, srcField] of Object.entries(outputMap)) {
            setPath(rec, destPath, raw[srcField]);
        }
        return rec;
    });
}

module.exports = { normalize };