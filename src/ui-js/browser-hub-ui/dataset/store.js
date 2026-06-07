'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = path.join(__dirname, '../data/dataset');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function projDir(pid)       { return path.join(ROOT, `proj-${pid}`); }
function dsDir(pid, dsid)   { return path.join(projDir(pid), `ds-${dsid}`); }
function projFile(pid)      { return path.join(projDir(pid), 'meta.json'); }
function dsListFile(pid)    { return path.join(projDir(pid), 'datasets.json'); }
function recordsFile(pid, dsid) { return path.join(dsDir(pid, dsid), 'records.jsonl'); }

function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function projectsIndexFile() { return path.join(ROOT, 'projects.json'); }
function allProjects()       { return readJson(projectsIndexFile(), []); }
function saveProjects(list)  { ensureDir(ROOT); writeJson(projectsIndexFile(), list); }

// ── Projects ──────────────────────────────────────────────────────────────────

function createProject(name, description = '') {
    const id  = uuidv4();
    const rec = { id, name, description, createdAt: new Date().toISOString() };
    ensureDir(projDir(id));
    writeJson(projFile(id), rec);
    writeJson(dsListFile(id), []);
    const list = allProjects();
    list.push({ id, name, description, createdAt: rec.createdAt });
    saveProjects(list);
    return rec;
}

function listProjects() { return allProjects(); }

function getProject(id) {
    return readJson(projFile(id), null);
}

function deleteProject(id) {
    fs.rmSync(projDir(id), { recursive: true, force: true });
    saveProjects(allProjects().filter(p => p.id !== id));
}

// ── DataSets ──────────────────────────────────────────────────────────────────

function listDataSets(projectId) {
    return readJson(dsListFile(projectId), []);
}

function createDataSet(projectId, name, description = '', schema = null) {
    const id  = uuidv4();
    const rec = { id, projectId, name, description, schema, recordCount: 0, createdAt: new Date().toISOString() };
    ensureDir(dsDir(projectId, id));
    const list = listDataSets(projectId);
    list.push(rec);
    writeJson(dsListFile(projectId), list);
    return rec;
}

function getDataSet(projectId, dataSetId) {
    return listDataSets(projectId).find(d => d.id === dataSetId) || null;
}

function updateDataSetCount(projectId, dataSetId, delta) {
    const list = listDataSets(projectId);
    const ds   = list.find(d => d.id === dataSetId);
    if (ds) { ds.recordCount = Math.max(0, (ds.recordCount || 0) + delta); }
    writeJson(dsListFile(projectId), list);
}

function deleteDataSet(projectId, dataSetId) {
    fs.rmSync(dsDir(projectId, dataSetId), { recursive: true, force: true });
    writeJson(dsListFile(projectId), listDataSets(projectId).filter(d => d.id !== dataSetId));
}

// ── DataRecords ───────────────────────────────────────────────────────────────

function addRecords(projectId, dataSetId, records) {
    const dir  = dsDir(projectId, dataSetId);
    ensureDir(dir);
    const file = recordsFile(projectId, dataSetId);
    const lines = records.map(r => JSON.stringify({ ...r, _id: uuidv4(), _addedAt: new Date().toISOString() }));
    fs.appendFileSync(file, lines.join('\n') + '\n');
    updateDataSetCount(projectId, dataSetId, records.length);
    const ds = getDataSet(projectId, dataSetId);
    return { added: records.length, total: ds?.recordCount || records.length };
}

function readAllRecords(projectId, dataSetId) {
    const file = recordsFile(projectId, dataSetId);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
}

function getRecords(projectId, dataSetId, { offset = 0, limit = 100, search = '' } = {}) {
    let records = readAllRecords(projectId, dataSetId);
    if (search) {
        const q = search.toLowerCase();
        records = records.filter(r => JSON.stringify(r).toLowerCase().includes(q));
    }
    return { records: records.slice(offset, offset + limit), total: records.length, offset, limit };
}

function clearRecords(projectId, dataSetId) {
    const file = recordsFile(projectId, dataSetId);
    if (fs.existsSync(file)) fs.writeFileSync(file, '');
    const list = listDataSets(projectId);
    const ds   = list.find(d => d.id === dataSetId);
    if (ds) ds.recordCount = 0;
    writeJson(dsListFile(projectId), list);
}

function flattenRecord(rec, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(out, flattenRecord(v, key));
        } else {
            out[key] = v;
        }
    }
    return out;
}

function exportRecords(projectId, dataSetId, format = 'json') {
    const records = readAllRecords(projectId, dataSetId);
    if (format === 'csv') {
        if (records.length === 0) return '';
        const flat   = records.map(flattenRecord);
        const keys   = [...new Set(flat.flatMap(Object.keys))];
        const header = keys.join(',');
        const rows   = flat.map(r => keys.map(k => {
            const v = String(r[k] ?? '').replace(/"/g, '""');
            return `"${v}"`;
        }).join(','));
        return [header, ...rows].join('\n');
    }
    return JSON.stringify(records, null, 2);
}

module.exports = {
    createProject, listProjects, getProject, deleteProject,
    createDataSet, listDataSets, getDataSet, deleteDataSet,
    addRecords, getRecords, clearRecords, exportRecords,
};