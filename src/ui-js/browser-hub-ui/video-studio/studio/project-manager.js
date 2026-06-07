'use strict';

// ── Project Manager ────────────────────────────────────────────────────────────
// Sole storage layer for all project types.
//
// Project types:
//   video     — slides + audio + clips → exported MP4 (Video Studio)
//   dataset   — DataRecords from browser extraction (Browser Studio)
//
// Disk layout:
//   data/users/{userId}/projects/{projectId}/
//     project.json              ← project metadata
//
//   Video projects additionally:
//     slides/{slideId}/
//       image.{ext} | audio.mp3 | clip.mp4
//
//   Dataset projects additionally:
//     records/{recordId}.json   ← each DataRecord

const fs   = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'users');

// ── Internal helpers ───────────────────────────────────────────────────────────

function _userDir(userId)                         { return path.join(DATA_ROOT, userId); }
function _projectDir(userId, projectId)           { return path.join(_userDir(userId), 'projects', projectId); }
function _projectFile(userId, projectId)          { return path.join(_projectDir(userId, projectId), 'project.json'); }
function _slideDir(userId, projectId, slideId)    { return path.join(_projectDir(userId, projectId), 'slides', slideId); }
function _recordsDir(userId, projectId)           { return path.join(_projectDir(userId, projectId), 'records'); }
function _recordFile(userId, projectId, recordId) { return path.join(_recordsDir(userId, projectId), `${recordId}.json`); }

function _ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function _newId()      { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function _readProject(userId, projectId) {
    const f = _projectFile(userId, projectId);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function _writeProject(userId, projectId, data) {
    _ensureDir(_projectDir(userId, projectId));
    fs.writeFileSync(_projectFile(userId, projectId), JSON.stringify(data, null, 2), 'utf8');
}

// ── Projects ───────────────────────────────────────────────────────────────────

function createProject(userId, { name, type = 'video', description = '', parentId = null }) {
    const projectId = _newId();
    const now = new Date().toISOString();
    const base = { id: projectId, userId, name, type, description, parentId, createdAt: now, updatedAt: now };

    let data;
    if (type === 'dataset') {
        data = { ...base, recordCount: 0 };
        _ensureDir(_recordsDir(userId, projectId));
    } else {
        data = { ...base, videoStatus: null, videoPath: null, slides: [], slideMap: {} };
        _ensureDir(path.join(_projectDir(userId, projectId), 'slides'));
    }

    _writeProject(userId, projectId, data);
    return data;
}

function listProjects(userId, type = null, parentId = undefined) {
    const dir = path.join(_userDir(userId), 'projects');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map(id => _readProject(userId, id))
        .filter(Boolean)
        .filter(p => !type || p.type === type)
        .filter(p => {
            if (parentId === undefined) return true;
            if (parentId === null) return !p.parentId;
            return p.parentId === parentId;
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getProject(userId, projectId) { return _readProject(userId, projectId); }

function updateProject(userId, projectId, patch) {
    const data = _readProject(userId, projectId);
    if (!data) return null;
    Object.assign(data, patch, { updatedAt: new Date().toISOString() });
    _writeProject(userId, projectId, data);
    return data;
}

function deleteProject(userId, projectId) {
    const dir = _projectDir(userId, projectId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── Slides (Video projects only) ───────────────────────────────────────────────

function addSlide(userId, projectId, slideData) {
    const data = _readProject(userId, projectId);
    if (!data) throw new Error('Project not found');
    if (data.type !== 'video') throw new Error('Project is not a video project');
    const slideId = _newId();
    const now     = new Date().toISOString();
    const slide   = {
        id: slideId, projectId,
        order:         data.slides.length,
        title:         slideData.title     || `Slide ${data.slides.length + 1}`,
        script:        slideData.script    || '',
        voice:         slideData.voice     || null,
        imagePath:     slideData.imagePath || null,
        imageExt:      slideData.imageExt  || null,
        audioPath:     null,
        clipPath:      null,
        audioDuration: null,
        createdAt: now, updatedAt: now,
    };
    _ensureDir(_slideDir(userId, projectId, slideId));
    data.slides.push(slideId);
    data.slideMap[slideId] = slide;
    data.updatedAt = now;
    _writeProject(userId, projectId, data);
    return slide;
}

function getSlide(userId, projectId, slideId) {
    const data = _readProject(userId, projectId);
    return data ? (data.slideMap?.[slideId] || null) : null;
}

function updateSlide(userId, projectId, slideId, patch) {
    const data = _readProject(userId, projectId);
    if (!data || !data.slideMap?.[slideId]) return null;
    Object.assign(data.slideMap[slideId], patch, { updatedAt: new Date().toISOString() });
    data.updatedAt = new Date().toISOString();
    _writeProject(userId, projectId, data);
    return data.slideMap[slideId];
}

function deleteSlide(userId, projectId, slideId) {
    const data = _readProject(userId, projectId);
    if (!data) return;
    data.slides = data.slides.filter(id => id !== slideId);
    delete data.slideMap[slideId];
    data.updatedAt = new Date().toISOString();
    _writeProject(userId, projectId, data);
    const dir = _slideDir(userId, projectId, slideId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function reorderSlides(userId, projectId, newOrder) {
    const data = _readProject(userId, projectId);
    if (!data) return null;
    const existing = new Set(data.slides);
    const valid = newOrder.filter(id => existing.has(id));
    data.slides = valid;
    valid.forEach((id, i) => { if (data.slideMap[id]) data.slideMap[id].order = i; });
    data.updatedAt = new Date().toISOString();
    _writeProject(userId, projectId, data);
    return data;
}

function getOrderedSlides(userId, projectId) {
    const data = _readProject(userId, projectId);
    if (!data) return [];
    return (data.slides || []).map(id => data.slideMap[id]).filter(Boolean);
}

// ── DataRecords (Dataset projects only) ───────────────────────────────────────

function addDataRecord(userId, projectId, recordData) {
    const proj = _readProject(userId, projectId);
    if (!proj) throw new Error('Project not found');
    if (proj.type !== 'dataset') throw new Error('Project is not a Dataset');

    const recordId = _newId();
    const now      = new Date().toISOString();
    const record   = {
        id:          recordId,
        projectId,
        url:         recordData.url        || null,
        title:       recordData.title      || '',
        fields:      recordData.fields     || {},   // key-value extracted data
        rawText:     recordData.rawText    || null,
        rawHtml:     recordData.rawHtml    || null,
        tags:        recordData.tags       || [],
        capturedAt:  recordData.capturedAt || now,
        createdAt:   now,
        updatedAt:   now,
    };

    _ensureDir(_recordsDir(userId, projectId));
    fs.writeFileSync(_recordFile(userId, projectId, recordId), JSON.stringify(record, null, 2), 'utf8');

    proj.recordCount = (proj.recordCount || 0) + 1;
    proj.updatedAt = now;
    _writeProject(userId, projectId, proj);

    return record;
}

function getDataRecord(userId, projectId, recordId) {
    const f = _recordFile(userId, projectId, recordId);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function listDataRecords(userId, projectId, { page = 1, limit = 50, search = '' } = {}) {
    const dir = _recordsDir(userId, projectId);
    if (!fs.existsSync(dir)) return { records: [], total: 0, page, limit };

    let records = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

    if (search) {
        const q = search.toLowerCase();
        records = records.filter(r =>
            (r.url  || '').toLowerCase().includes(q) ||
            (r.title|| '').toLowerCase().includes(q) ||
            JSON.stringify(r.fields).toLowerCase().includes(q)
        );
    }

    const total = records.length;
    const start = (page - 1) * limit;
    return { records: records.slice(start, start + limit), total, page, limit };
}

function updateDataRecord(userId, projectId, recordId, patch) {
    const f = _recordFile(userId, projectId, recordId);
    if (!fs.existsSync(f)) return null;
    const record = JSON.parse(fs.readFileSync(f, 'utf8'));
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(f, JSON.stringify(record, null, 2), 'utf8');
    return record;
}

function deleteDataRecord(userId, projectId, recordId) {
    const f = _recordFile(userId, projectId, recordId);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    const proj = _readProject(userId, projectId);
    if (proj) {
        proj.recordCount = Math.max(0, (proj.recordCount || 1) - 1);
        proj.updatedAt = new Date().toISOString();
        _writeProject(userId, projectId, proj);
    }
    return true;
}

function clearDataRecords(userId, projectId) {
    const dir = _recordsDir(userId, projectId);
    if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.endsWith('.json'))
            .forEach(f => fs.unlinkSync(path.join(dir, f)));
    }
    const proj = _readProject(userId, projectId);
    if (proj) { proj.recordCount = 0; proj.updatedAt = new Date().toISOString(); _writeProject(userId, projectId, proj); }
}

// ── File path helpers ──────────────────────────────────────────────────────────

function slideDir(userId, projectId, slideId)  { return _slideDir(userId, projectId, slideId); }
function projectDir(userId, projectId)          { return _projectDir(userId, projectId); }
function slideImagePath(userId, projectId, slideId, ext) {
    return path.join(_slideDir(userId, projectId, slideId), `image.${ext}`);
}
function slideAudioPath(userId, projectId, slideId) {
    return path.join(_slideDir(userId, projectId, slideId), 'audio.mp3');
}
function slideClipPath(userId, projectId, slideId) {
    return path.join(_slideDir(userId, projectId, slideId), 'clip.mp4');
}
function projectVideoPath(userId, projectId) {
    return path.join(_projectDir(userId, projectId), 'output.mp4');
}

module.exports = {
    getUserDir: (userId) => { const d = _userDir(userId); _ensureDir(d); return d; },
    createProject, listProjects, getProject, updateProject, deleteProject,
    addSlide, getSlide, updateSlide, deleteSlide, reorderSlides, getOrderedSlides,
    addDataRecord, getDataRecord, listDataRecords, updateDataRecord, deleteDataRecord, clearDataRecords,
    slideDir, projectDir, slideImagePath, slideAudioPath, slideClipPath, projectVideoPath,
};
