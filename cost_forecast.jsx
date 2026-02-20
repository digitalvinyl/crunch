// When loaded via <script type="text/babel">, React & Recharts are browser globals.
// When bundled (Vite/esbuild), swap these two lines back to ES module imports:
//   import React, { useState, ... } from "react";
//   import { AreaChart, ... } from "recharts";
const _React = typeof React !== "undefined" ? React : (typeof require === "function" ? require("react") : {});
const { useState, useMemo, useCallback, useRef, useEffect, useContext, createContext } = _React;
const _Recharts = typeof Recharts !== "undefined" ? Recharts : (typeof require === "function" ? require("recharts") : {});
const { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, ReferenceLine, Cell } = _Recharts;

const FONT = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
const DISPLAY_FONT = "'Barlow Condensed', 'Oswald', 'Arial Narrow', sans-serif";
const SIDEBAR_WIDTH = 195;

const DARK_COLORS = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceAlt: "#222633",
  border: "#2d3348",
  borderLight: "#3d4560",
  text: "#e8eaf0",
  textDim: "#9ba3bb",
  textMuted: "#6d7694",
  accent: "#f59e0b",
  accentDim: "#d97706",
  accentLight: "#fbbf24",
  green: "#22c55e",
  greenDim: "#166534",
  red: "#ef4444",
  redDim: "#991b1b",
  blue: "#3b82f6",
  blueDim: "#1e3a5f",
  purple: "#a78bfa",
  cyan: "#22d3ee",
  orange: "#f97316",
  chartDirect: "#3b82f6",
  chartTime: "#f59e0b",
  chartTotal: "#e8eaf0",
};

const LIGHT_COLORS = {
  bg: "#f5f6fa",
  surface: "#ffffff",
  surfaceAlt: "#f0f1f5",
  border: "#d1d5e0",
  borderLight: "#bfc4d3",
  text: "#1a1d27",
  textDim: "#4a5168",
  textMuted: "#6b7280",
  accent: "#d97706",
  accentDim: "#b45309",
  accentLight: "#f59e0b",
  green: "#16a34a",
  greenDim: "#bbf7d0",
  red: "#dc2626",
  redDim: "#fecaca",
  blue: "#2563eb",
  blueDim: "#dbeafe",
  purple: "#7c3aed",
  cyan: "#0891b2",
  orange: "#ea580c",
  chartDirect: "#2563eb",
  chartTime: "#d97706",
  chartTotal: "#1a1d27",
};

const ThemeContext = createContext("dark");

function useColors() {
  const theme = useContext(ThemeContext);
  return theme === "light" ? LIGHT_COLORS : DARK_COLORS;
}

// Default for top-level code that runs outside components
let COLORS = LIGHT_COLORS;

const DISCIPLINE_COLORS = ["#3b82f6", "#22c55e", "#a78bfa", "#f43f5e", "#22d3ee", "#f59e0b", "#ec4899", "#84cc16"];

const defaultDisciplines = [
  { id: 1, name: "Civil", rate: 72, otRate: 108 },
  { id: 2, name: "Electrical", rate: 75, otRate: 112.5 },
  { id: 3, name: "Instrumentation", rate: 74, otRate: 111 },
  { id: 4, name: "Mechanical", rate: 78, otRate: 117 },
  { id: 5, name: "Piping", rate: 76, otRate: 114 },
];

const defaultTimeCosts = [
  { id: 1, name: "Temporary Facilities", basis: "monthly", rate: 45000 },
  { id: 2, name: "Site Management / Supervision", basis: "monthly", rate: 125000 },
  { id: 3, name: "Equipment Rental", basis: "weekly", rate: 18000 },
  { id: 4, name: "Security & Safety", basis: "monthly", rate: 22000 },
  { id: 5, name: "Temporary Power", basis: "monthly", rate: 15000 },
];

function generatePhasedHours(numWeeks, startWeek, endWeek, peakWeek, peakHours, rampUp, rampDown) {
  const hours = [];
  for (let w = 0; w < numWeeks; w++) {
    if (w < startWeek || w >= endWeek) {
      hours.push(0);
    } else if (w < peakWeek) {
      const progress = (w - startWeek) / (peakWeek - startWeek);
      hours.push(Math.round(peakHours * Math.pow(progress, rampUp)));
    } else {
      const remaining = (w - peakWeek) / (endWeek - peakWeek);
      hours.push(Math.round(peakHours * Math.pow(1 - remaining, rampDown)));
    }
  }
  return hours;
}

const NUM_WEEKS = 9;
const defaultHoursData = {
  // Pump House-1 — L9911 Raw Water Intake Facility Installation
  1: [459, 262, 0, 0, 0, 18, 5, 0, 0],       // Civil
  2: [0, 0, 0, 0, 0, 423, 480, 599, 0],       // Electrical
  3: [0, 0, 0, 0, 0, 0, 0, 0, 35],            // Instrumentation
  4: [0, 0, 451, 574, 695, 843, 845, 0, 0],   // Mechanical
  5: [0, 437, 437, 437, 437, 823, 0, 0, 0],   // Piping
};

// ═══════════════════════════════════════════════════════════════════════
// XER File Parser — Primavera P6 schedule import
// Parses tab-delimited XER format, extracts activities & resource
// assignments, groups into disciplines, builds weekly hours profiles.
// ═══════════════════════════════════════════════════════════════════════
function parseXER(text) {
  const tables = {};
  let currentTable = null;
  let fields = [];

  text.split(/\r?\n/).forEach(line => {
    if (line.startsWith('%T')) {
      currentTable = line.split('\t')[1]?.trim();
      if (currentTable) tables[currentTable] = [];
      fields = [];
    } else if (line.startsWith('%F') && currentTable) {
      fields = line.split('\t').slice(1).map(f => f.trim());
    } else if (line.startsWith('%R') && currentTable && fields.length > 0) {
      const values = line.split('\t').slice(1);
      const row = {};
      fields.forEach((f, i) => { row[f] = values[i]?.trim() || ''; });
      tables[currentTable].push(row);
    }
  });
  return tables;
}

function parseP6Date(dateStr) {
  if (!dateStr) return null;
  // P6 dates come in many formats:
  //   "2024-03-15 08:00"  (ISO-ish with time)
  //   "15-Mar-24 08:00"   (dd-Mon-yy)
  //   "2024-03-15"        (ISO date)
  //   "03/15/24"          (US short)
  //   "2024-03-15T08:00:00" (ISO8601)
  const s = dateStr.trim();

  // Try native parse first (handles ISO and many formats)
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  // Try stripping time portion
  d = new Date(s.replace(/\s+\d{1,2}:\d{2}.*$/, ''));
  if (!isNaN(d.getTime())) return d;

  // Handle "dd-Mon-yy" format common in P6
  const ddMonYy = s.match(/^(\d{1,2})-(\w{3})-(\d{2,4})\b/);
  if (ddMonYy) {
    const [, day, mon, yr] = ddMonYy;
    const year = yr.length === 2 ? (parseInt(yr) < 80 ? `20${yr}` : `19${yr}`) : yr;
    d = new Date(`${mon} ${day}, ${year}`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function processXER(text) {
  const tables = parseXER(text);

  // ── Multi-project handling ──
  // Large XER exports often contain multiple projects (EPS nodes, admin projects, etc.).
  // Instead of blindly picking projects[0], find the project with the most task activities.
  const projects = tables.PROJECT || [];
  const allTasks = tables.TASK || [];

  let project = projects[0];
  if (projects.length > 1) {
    // Count actual task activities per project (exclude WBS summaries and LOE)
    const taskCountByProj = {};
    projects.forEach(p => { taskCountByProj[p.proj_id] = 0; });
    allTasks.forEach(t => {
      if (t.task_type === 'TT_WBS' || t.task_type === 'TT_LOE') return;
      if (t.proj_id && taskCountByProj[t.proj_id] !== undefined) {
        taskCountByProj[t.proj_id]++;
      }
    });
    // Pick project with most tasks
    let maxCount = 0;
    projects.forEach(p => {
      const count = taskCountByProj[p.proj_id] || 0;
      if (count > maxCount) { maxCount = count; project = p; }
    });
    console.log(`XER multi-project: ${projects.length} projects found. Selected "${project.proj_short_name || project.proj_id}" with ${maxCount} tasks.`);
    console.log(`  All projects: ${projects.map(p => `${p.proj_short_name || p.proj_id} (${taskCountByProj[p.proj_id] || 0} tasks)`).join(', ')}`);
  }

  // Resource lookup
  const rsrcMap = {};
  (tables.RSRC || []).forEach(r => {
    rsrcMap[r.rsrc_id] = {
      name: r.rsrc_name || r.rsrc_short_name || 'Unknown',
      type: r.rsrc_type || '',
    };
  });

  // Activity Code lookups
  const codeTypeMap = {};
  (tables.ACTVTYPE || []).forEach(t => {
    codeTypeMap[t.actv_code_type_id] = t.actv_code_type || '';
  });
  const codeMap = {};
  (tables.ACTVCODE || []).forEach(c => {
    codeMap[c.actv_code_id] = {
      name: c.actv_code_name || c.short_name || '',
      typeId: c.actv_code_type_id || '',
    };
  });
  const taskCodes = {};
  (tables.TASKACTV || []).forEach(ta => {
    if (!taskCodes[ta.task_id]) taskCodes[ta.task_id] = [];
    taskCodes[ta.task_id].push(codeMap[ta.actv_code_id] || { name: '', typeId: '' });
  });

  // WBS lookup
  const wbsMap = {};
  (tables.PROJWBS || []).forEach(w => {
    wbsMap[w.wbs_id] = { name: w.wbs_name || w.wbs_short_name || '', parentId: w.parent_wbs_id || '' };
  });

  // Parse tasks — filter to selected project
  const projId = project?.proj_id || '';
  const tasks = {};
  let skippedWbs = 0, skippedLoe = 0, skippedDates = 0, skippedProj = 0;
  allTasks.forEach(t => {
    if (projId && t.proj_id && t.proj_id !== projId) { skippedProj++; return; }
    if (t.task_type === 'TT_WBS') { skippedWbs++; return; }
    if (t.task_type === 'TT_LOE') { skippedLoe++; return; }
    const start = parseP6Date(t.target_start_date || t.early_start_date || t.act_start_date);
    const end = parseP6Date(t.target_end_date || t.early_end_date || t.act_end_date);
    if (!start || !end || end <= start) { skippedDates++; return; }
    tasks[t.task_id] = { name: t.task_name || '', start, end, wbsId: t.wbs_id || '' };
  });
  console.log(`XER tasks: ${Object.keys(tasks).length} parsed, skipped: ${skippedProj} other-project, ${skippedWbs} WBS, ${skippedLoe} LOE, ${skippedDates} bad-dates (of ${allTasks.length} total)`);

  // Resource assignments — try target_qty first, then remain_qty, then target_cost/rate
  const assignments = [];
  let rsrcSkippedNoTask = 0, rsrcSkippedNoHours = 0, rsrcSkippedEquipMat = 0;
  (tables.TASKRSRC || []).forEach(tr => {
    const task = tasks[tr.task_id];
    if (!task) { rsrcSkippedNoTask++; return; }
    // Hours: prefer target_qty (planned), then sum actual + remaining, then individual fields
    let hours = parseFloat(tr.target_qty || 0);
    if (hours <= 0) {
      const actReg = parseFloat(tr.act_reg_qty || 0);
      const actOt = parseFloat(tr.act_ot_qty || 0);
      const remain = parseFloat(tr.remain_qty || 0);
      hours = actReg + actOt + remain;
    }
    if (hours <= 0) { rsrcSkippedNoHours++; return; }
    const rsrc = rsrcMap[tr.rsrc_id] || { name: 'Unknown', type: '' };
    if (rsrc.type === 'RT_Equip' || rsrc.type === 'RT_Mat') { rsrcSkippedEquipMat++; return; }
    assignments.push({
      taskId: tr.task_id, rsrcName: rsrc.name, hours,
      start: task.start, end: task.end, wbsId: task.wbsId,
      taskCodes: taskCodes[tr.task_id] || [],
    });
  });
  console.log(`XER assignments: ${assignments.length} parsed, skipped: ${rsrcSkippedNoTask} no-task, ${rsrcSkippedNoHours} no-hours, ${rsrcSkippedEquipMat} equip/mat (of ${(tables.TASKRSRC || []).length} total)`);

  // Fallback: use task duration hours if no resource assignments
  if (assignments.length === 0) {
    console.log('XER: No resource assignments found, falling back to task duration hours');
    Object.entries(tasks).forEach(([id, task]) => {
      const t = allTasks.find(tt => tt.task_id === id);
      const hours = parseFloat(t?.remain_drtn_hr_cnt || t?.target_drtn_hr_cnt || 0);
      if (hours <= 0) return;
      assignments.push({
        taskId: id, rsrcName: 'General', hours,
        start: task.start, end: task.end, wbsId: task.wbsId,
        taskCodes: taskCodes[id] || [],
      });
    });
    console.log(`XER fallback: ${assignments.length} tasks with duration hours`);
  }

  if (assignments.length === 0) throw new Error('No resource assignments or task hours found in XER file');

  // ── Determine discipline grouping ──
  // Priority: 1) Activity code "Discipline"/"Trade"/"Craft"/"Area", 2) WBS L2/L3, 3) Resource name
  let groupBy = 'resource';

  const discCodeType = Object.entries(codeTypeMap).find(([, name]) => {
    const n = name.toLowerCase();
    return n.includes('discipline') || n.includes('trade') || n.includes('craft') || n.includes('area');
  });

  if (discCodeType) {
    groupBy = 'activityCode';
    assignments.forEach(a => {
      const match = a.taskCodes.find(c => c.typeId === discCodeType[0]);
      a.discipline = match ? match.name : 'Other';
    });
  } else {
    // Try WBS grouping
    const getWbsChain = (id) => {
      const chain = [];
      let cur = id;
      while (cur && wbsMap[cur]) { chain.unshift(wbsMap[cur].name); cur = wbsMap[cur].parentId; }
      return chain;
    };
    const wbsGroups = {};
    assignments.forEach(a => {
      const chain = getWbsChain(a.wbsId);
      const level = chain.length >= 3 ? 2 : chain.length >= 2 ? 1 : 0;
      a.discipline = chain[level] || a.rsrcName || 'General';
      wbsGroups[a.discipline] = (wbsGroups[a.discipline] || 0) + a.hours;
    });
    const wbsCount = Object.keys(wbsGroups).length;
    if (wbsCount >= 2 && wbsCount <= 12) {
      groupBy = 'wbs';
    } else {
      groupBy = 'resource';
      assignments.forEach(a => { a.discipline = a.rsrcName; });
    }
  }

  // Consolidate small disciplines (< 2% of total)
  const discHours = {};
  assignments.forEach(a => { discHours[a.discipline] = (discHours[a.discipline] || 0) + a.hours; });
  const totalHours = Object.values(discHours).reduce((s, h) => s + h, 0);
  const smallDiscs = new Set(Object.entries(discHours).filter(([, h]) => h < totalHours * 0.02).map(([n]) => n));
  if (smallDiscs.size > 0) assignments.forEach(a => { if (smallDiscs.has(a.discipline)) a.discipline = 'Other'; });

  // ── Compute project time frame ──
  let projStart = new Date(Math.min(...assignments.map(a => a.start.getTime())));
  let projEnd = new Date(Math.max(...assignments.map(a => a.end.getTime())));
  // Snap to Monday
  const dow = projStart.getDay();
  if (dow !== 1) projStart.setDate(projStart.getDate() - (dow === 0 ? 6 : dow - 1));

  const totalDays = Math.ceil((projEnd - projStart) / (86400000));
  const numWeeks = Math.max(4, Math.ceil(totalDays / 7));

  // ── Build weekly hours per discipline ──
  const discNames = [...new Set(assignments.map(a => a.discipline))].sort();
  const disciplines = discNames.map((name, i) => ({
    id: i + 1, name, rate: 75, otRate: 112.5,
  }));
  const discIdMap = {};
  discNames.forEach((name, i) => { discIdMap[name] = i + 1; });

  const hoursData = {};
  disciplines.forEach(d => { hoursData[d.id] = new Array(numWeeks).fill(0); });

  const msPerWeek = 7 * 86400000;
  const projStartMs = projStart.getTime();

  assignments.forEach(a => {
    const discId = discIdMap[a.discipline];
    if (!discId) return;
    const taskDays = Math.max(1, (a.end - a.start) / 86400000);
    const hoursPerDay = a.hours / taskDays;

    // Walk week-by-week through the task span
    const firstWeek = Math.max(0, Math.floor((a.start.getTime() - projStartMs) / msPerWeek));
    const lastWeek = Math.min(numWeeks - 1, Math.floor((a.end.getTime() - projStartMs - 1) / msPerWeek));

    for (let w = firstWeek; w <= lastWeek; w++) {
      const weekStartMs = projStartMs + w * msPerWeek;
      const weekEndMs = weekStartMs + msPerWeek;
      const overlapStart = Math.max(a.start.getTime(), weekStartMs);
      const overlapEnd = Math.min(a.end.getTime(), weekEndMs);
      const overlapDays = Math.max(0, (overlapEnd - overlapStart) / 86400000);
      const workDays = overlapDays * 5 / 7;
      hoursData[discId][w] += Math.round(hoursPerDay * workDays);
    }
  });

  return {
    disciplines, hoursData,
    baseWeeks: numWeeks,
    startDate: projStart.toISOString().split('T')[0],
    groupBy,
    summary: {
      taskCount: Object.keys(tasks).length,
      assignmentCount: assignments.length,
      totalHours: Math.round(totalHours),
      disciplineCount: disciplines.length,
      projectName: project?.proj_short_name || project?.proj_id || 'Imported Project',
      projectCount: projects.length,
      totalTasksInFile: allTasks.length,
      skipped: { proj: skippedProj, wbs: skippedWbs, loe: skippedLoe, dates: skippedDates },
      totalRsrcInFile: (tables.TASKRSRC || []).length,
    },
    // Task-level schedule for Gantt display
    schedule: buildScheduleData(tasks, assignments, tables, discIdMap, projStart, numWeeks),
  };
}

function buildScheduleData(tasks, assignments, tables, discIdMap, projStart, numWeeks) {
  const projStartMs = projStart.getTime();
  const msPerDay = 86400000;

  // Map taskId → discipline (from assignments)
  const taskDisc = {};
  assignments.forEach(a => {
    if (!taskDisc[a.taskId]) taskDisc[a.taskId] = a.discipline;
  });

  // Aggregate hours per task
  const taskHours = {};
  assignments.forEach(a => {
    taskHours[a.taskId] = (taskHours[a.taskId] || 0) + a.hours;
  });

  // Build activities list
  const activities = Object.entries(tasks).map(([id, t]) => {
    const disc = taskDisc[id] || 'Unassigned';
    const discId = discIdMap[disc] || 0;
    const startDay = (t.start.getTime() - projStartMs) / msPerDay;
    const endDay = (t.end.getTime() - projStartMs) / msPerDay;
    const rawTask = (tables.TASK || []).find(tt => tt.task_id === id);
    const totalFloat = rawTask ? parseFloat(rawTask.total_float_hr_cnt || 0) / 8 : 0; // convert to days
    const isCritical = totalFloat <= 0;
    return {
      id, name: t.name, start: t.start, end: t.end,
      startDay, endDay,
      discipline: disc, discId,
      hours: taskHours[id] || 0,
      totalFloat,
      isCritical,
      status: rawTask?.status_code || '',
    };
  }).sort((a, b) => a.endDay - b.endDay || a.startDay - b.startDay);

  // Parse relationships (TASKPRED)
  const relationships = [];
  (tables.TASKPRED || []).forEach(r => {
    const fromId = r.pred_task_id;
    const toId = r.task_id;
    if (!tasks[fromId] || !tasks[toId]) return;
    const predType = r.pred_type || 'PR_FS'; // FS, FF, SS, SF
    const lag = parseFloat(r.lag_hr_cnt || 0) / 8; // hours to days
    relationships.push({ fromId, toId, type: predType, lag });
  });

  return { activities, relationships, projStartMs, numWeeks };
}

// Core proportional redistribution (used internally)
function _redistributeProportional(originalHours, originalLen, newLen) {
  const totalHours = originalHours.reduce((s, h) => s + h, 0);
  if (totalHours === 0) return new Array(newLen).fill(0);

  const cumulative = [0];
  for (let i = 0; i < originalHours.length; i++) {
    cumulative.push(cumulative[i] + originalHours[i]);
  }
  const normCum = cumulative.map((v) => v / totalHours);

  const newHours = [];
  for (let w = 0; w < newLen; w++) {
    const startFrac = w / newLen;
    const endFrac = (w + 1) / newLen;
    const getOrigCumValue = (frac) => {
      const origPos = frac * originalLen;
      const idx = Math.floor(origPos);
      const remainder = origPos - idx;
      if (idx >= originalLen) return 1;
      if (idx < 0) return 0;
      return normCum[idx] + remainder * (normCum[idx + 1] - normCum[idx]);
    };
    const hoursFrac = getOrigCumValue(endFrac) - getOrigCumValue(startFrac);
    newHours.push(Math.round(hoursFrac * totalHours));
  }
  const newTotal = newHours.reduce((s, h) => s + h, 0);
  const diff = totalHours - newTotal;
  if (diff !== 0) {
    const maxIdx = newHours.indexOf(Math.max(...newHours));
    newHours[maxIdx] += diff;
  }
  return newHours;
}

// Phase-aware redistribution: only compresses disciplines that extend past the target end.
// Disciplines finishing before targetWeeks are left untouched.
function redistributeHours(originalHours, originalWeeks, targetWeeks) {
  if (targetWeeks === originalWeeks) return [...originalHours];
  const totalHours = originalHours.reduce((s, h) => s + h, 0);
  if (totalHours === 0) return new Array(targetWeeks).fill(0);

  // Both compression and extension: proportional CDF mapping.
  // The entire hours profile scales proportionally, preserving the S-curve
  // shape and relative discipline positions. This matches how real schedule
  // acceleration works — all tasks shift proportionally earlier/later.
  return _redistributeProportional(originalHours, originalWeeks, targetWeeks);
}

// OT blended rate: when OT is selected, ALL weeks run the OT schedule.
// Sat OT = 60 hrs/wk (50 base + 10 OT). Sat+Sun OT = 70 hrs/wk (50 base + 20 OT).
// The blended rate is CONSTANT for the entire project duration.
const OT_MODES = { none: "No OT", sat: "Sat OT", satSun: "Sat+Sun OT" };

// OT capacity: base week = 5 × 10 = 50 hrs; OT days are 10 hrs each
// Sat OT = 50 + 10 = 60 hrs/wk (factor 1.20)
// Sat+Sun OT = 50 + 20 = 70 hrs/wk (factor 1.40)
const BASE_HRS_PER_WEEK = 50;
function getOtCapacity(otMode) {
  if (otMode === "sat") return { hrsPerWeek: 60, factor: 1.20 };
  if (otMode === "satSun") return { hrsPerWeek: 70, factor: 1.40 };
  return { hrsPerWeek: BASE_HRS_PER_WEEK, factor: 1.0 };
}

// Blended rate: base hours at base rate, OT hours at OT rate
function getOtBlendedRate(baseRate, otRate, otMode) {
  const cap = getOtCapacity(otMode);
  if (cap.hrsPerWeek <= BASE_HRS_PER_WEEK || !otRate) return baseRate;
  const otHrs = cap.hrsPerWeek - BASE_HRS_PER_WEEK;
  return (BASE_HRS_PER_WEEK * baseRate + otHrs * otRate) / cap.hrsPerWeek;
}

// Get the rate for a specific week: base rate for normal weeks, OT blended rate for OT weeks
function getWeekRate(baseRate, otRate, otMode, weekIndex, adjustedWeeks, baseWeeks) {
  if (otMode === "none" || adjustedWeeks >= baseWeeks) return baseRate;
  const numOtWeeks = getOtWeeks(adjustedWeeks, baseWeeks, otMode);
  const otStartWeek = adjustedWeeks - numOtWeeks;
  if (weekIndex >= otStartWeek) return getOtBlendedRate(baseRate, otRate, otMode);
  return baseRate;
}

// Compute total cost for a discipline at a given target duration with week-specific OT
function computeWeeklyOtCost(origHours, baseRate, otRate, otMode, baseWeeks, targetWeeks, costMultiplier) {
  if (targetWeeks === baseWeeks && otMode === "none") return origHours.reduce((s, h) => s + h, 0) * baseRate;
  const adjHours = redistributeHours(origHours, baseWeeks, targetWeeks);
  let cost = 0;
  for (let w = 0; w < targetWeeks; w++) {
    const rate = getWeekRate(baseRate, otRate, otMode, w, targetWeeks, baseWeeks);
    cost += (adjHours[w] || 0) * rate * costMultiplier;
  }
  return cost;
}

// Number of OT weeks needed at a given target duration
function getOtWeeks(targetWeeks, baseWeeks, otMode) {
  if (otMode === "none" || targetWeeks >= baseWeeks) return 0;
  const cap = getOtCapacity(otMode);
  const otHrs = cap.hrsPerWeek - BASE_HRS_PER_WEEK;
  return Math.round((baseWeeks - targetWeeks) * BASE_HRS_PER_WEEK / otHrs);
}

// OT utilization: what fraction of weeks are OT
function getOtUtilization(targetWeeks, baseWeeks, otMode) {
  if (otMode === "none" || targetWeeks >= baseWeeks) return 0;
  const k = getOtWeeks(targetWeeks, baseWeeks, otMode);
  return Math.min(1, k / targetWeeks);
}

// PF models fatigue from compression + OT schedule.
// At baseline (no compression): PF = 1.0.
// At max compression: PF = ACCEL_PF. Linear interpolation between.
function getAccelPF(w, baseWeeks, otCap, hoursData) {
  if (w >= baseWeeks || otCap.factor <= 1) return 1.0;
  const absoluteMinWeeks = Math.max(4, Math.ceil(baseWeeks * 5 / 7));
  const range = baseWeeks - absoluteMinWeeks;
  if (range <= 0) return 1.0;
  const compressionFrac = Math.min(1, (baseWeeks - w) / range);
  return 1.0 + (ACCEL_PF - 1.0) * compressionFrac;
}

// ═══════════════════════════════════════════════════════════════════════
// CPM-Based Task-Level Schedule Compression (Float-Aware Crashing)
// When XER schedule data is available, compression uses proper schedule
// crashing: only critical/near-critical tasks are compressed, while
// tasks with sufficient float absorb the compression naturally through
// the logic network. Full forward + backward pass CPM determines
// dynamic float and identifies the true critical path.
// ═══════════════════════════════════════════════════════════════════════

// CPM Forward Pass — compute early start/finish for each task.
// Lags are fixed physical constraints (e.g., cure time) — never compressed.
function runForwardPass(sorted, taskMap, predecessors) {
  sorted.forEach(id => {
    const task = taskMap[id];
    let es = 0;
    (predecessors[id] || []).forEach(r => {
      const pred = taskMap[r.fromId];
      if (!pred) return;
      const lagDays = Math.round(r.lag || 0);
      const type = r.type || 'PR_FS';
      let constraint;
      if (type === 'PR_FS' || type === 'FS') constraint = pred.earlyFinish + lagDays;
      else if (type === 'PR_SS' || type === 'SS') constraint = pred.earlyStart + lagDays;
      else if (type === 'PR_FF' || type === 'FF') constraint = pred.earlyFinish + lagDays - task.newDays;
      else if (type === 'PR_SF' || type === 'SF') constraint = pred.earlyStart + lagDays - task.newDays;
      else constraint = pred.earlyFinish + lagDays;
      es = Math.max(es, constraint);
    });
    task.earlyStart = Math.max(0, es);
    task.earlyFinish = task.earlyStart + task.newDays;
  });
  return Math.max(...Object.values(taskMap).map(t => t.earlyFinish));
}

// CPM Backward Pass — compute late start/finish and total float for each task.
// Traverses the topologically sorted list in reverse order.
function runBackwardPass(sorted, taskMap, successors) {
  const projectEndDay = Math.max(...Object.values(taskMap).map(t => t.earlyFinish));
  // Initialize all tasks with late dates at project end
  Object.values(taskMap).forEach(t => {
    t.lateFinish = projectEndDay;
    t.lateStart = projectEndDay - t.newDays;
  });
  // Traverse in reverse topological order
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const task = taskMap[id];
    let lf = task.lateFinish;
    let lsConstraint = Infinity; // for SS/SF constraints that directly constrain LS
    (successors[id] || []).forEach(r => {
      const succ = taskMap[r.toId];
      if (!succ) return;
      const lagDays = Math.round(r.lag || 0);
      const type = r.type || 'PR_FS';
      // Mirror of forward pass constraints:
      // FS: pred.EF + lag ≤ succ.ES → pred.LF ≤ succ.LS - lag
      // SS: pred.ES + lag ≤ succ.ES → pred.LS ≤ succ.LS - lag
      // FF: pred.EF + lag ≤ succ.EF → pred.LF ≤ succ.LF - lag
      // SF: pred.ES + lag ≤ succ.EF → pred.LS ≤ succ.LF - lag
      if (type === 'PR_FS' || type === 'FS') {
        lf = Math.min(lf, succ.lateStart - lagDays);
      } else if (type === 'PR_SS' || type === 'SS') {
        lsConstraint = Math.min(lsConstraint, succ.lateStart - lagDays);
      } else if (type === 'PR_FF' || type === 'FF') {
        lf = Math.min(lf, succ.lateFinish - lagDays);
      } else if (type === 'PR_SF' || type === 'SF') {
        lsConstraint = Math.min(lsConstraint, succ.lateFinish - lagDays);
      }
    });
    task.lateFinish = lf;
    task.lateStart = lf - task.newDays;
    // Apply direct LS constraints (from SS/SF relationships)
    if (lsConstraint < Infinity && lsConstraint < task.lateStart) {
      task.lateStart = lsConstraint;
      task.lateFinish = task.lateStart + task.newDays;
    }
    task.totalFloat = task.lateStart - task.earlyStart;
  }
  return projectEndDay;
}

// Run CPM-based schedule compression using float-aware crashing.
// Only critical/near-critical tasks are compressed; high-float tasks retain
// their original durations and absorb compression through the logic network.
// otMode controls the physical compression floor per task (Sat=5/6, Sat+Sun=5/7).
function compressByCPM(schedule, targetWeeks, baseWeeks, otMode) {
  if (!schedule || !schedule.activities || schedule.activities.length === 0) return null;
  const { activities, relationships } = schedule;

  const totalBaseDays = baseWeeks * 7;
  const totalTargetDays = targetWeeks * 7;
  const ratio = totalTargetDays / totalBaseDays;

  // OT compression floor: the minimum fraction each task's calendar duration can reach.
  // Base schedule = 5 work days per 7 calendar days.
  // Sat OT = 6 work days per 7 cal days → each task compresses to 5/6 of original.
  // Sat+Sun OT = 7 work days per 7 cal days → each task compresses to 5/7 of original.
  // No OT = no extra work days → tasks cannot compress (floor = 1.0).
  const BASE_WORK_DAYS = 5;
  let otWorkDays = BASE_WORK_DAYS;
  if (otMode === "sat") otWorkDays = 6;
  else if (otMode === "satSun") otWorkDays = 7;
  const otFloor = BASE_WORK_DAYS / otWorkDays; // 1.0, 5/6, or 5/7

  // Build task map with original durations
  const taskMap = {};
  activities.forEach(a => {
    const origDays = Math.max(1, a.endDay - a.startDay);
    taskMap[a.id] = {
      ...a, origDays,
      newDays: origDays,
      earlyStart: 0, earlyFinish: origDays,
      lateStart: 0, lateFinish: origDays, totalFloat: 0,
    };
  });

  // Build predecessor/successor maps
  const predecessors = {};
  const successors = {};
  activities.forEach(a => { predecessors[a.id] = []; successors[a.id] = []; });
  relationships.forEach(r => {
    if (taskMap[r.fromId] && taskMap[r.toId]) {
      predecessors[r.toId].push(r);
      successors[r.fromId].push(r);
    }
  });

  // Topological sort (Kahn's algorithm)
  const inDegree = {};
  activities.forEach(a => { inDegree[a.id] = 0; });
  relationships.forEach(r => {
    if (taskMap[r.fromId] && taskMap[r.toId]) inDegree[r.toId]++;
  });
  const queue = [];
  activities.forEach(a => { if (inDegree[a.id] === 0) queue.push(a.id); });
  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    (successors[id] || []).forEach(r => {
      inDegree[r.toId]--;
      if (inDegree[r.toId] === 0) queue.push(r.toId);
    });
  }
  // Add any remaining tasks (cycles or orphans)
  const sortedSet = new Set(sorted);
  activities.forEach(a => { if (!sortedSet.has(a.id)) sorted.push(a.id); });

  if (ratio >= 1.0) {
    // ── Extension: uniform proportional growth (unchanged behavior) ──
    Object.values(taskMap).forEach(t => {
      t.newDays = Math.round(t.origDays * ratio);
    });
    runForwardPass(sorted, taskMap, predecessors);
  } else {
    // ═══════════════════════════════════════════════════════════════════
    // Float-Aware Iterative Schedule Crashing
    //
    // Proper CPM crashing: repeatedly identify the critical path, then
    // distribute a small increment of compression proportionally across
    // critical tasks that have remaining OT capacity. Non-critical tasks
    // (those with float ≥ the compression achieved so far) are never
    // touched. This avoids over-compressing any single task or path.
    //
    // Phase 1: Full CPM (forward + backward) at original durations
    //          → establishes baseline critical path and dynamic float
    // Phase 2: Iterative 1-day crashing loop
    //          → each iteration: identify critical tasks, distribute
    //            1 day of compression proportionally, re-run CPM
    // Phase 3: Final CPM for accurate post-compression float values
    // ═══════════════════════════════════════════════════════════════════

    // ── Phase 1: CPM at original durations to compute dynamic float ──
    Object.values(taskMap).forEach(t => { t.newDays = t.origDays; });
    runForwardPass(sorted, taskMap, predecessors);
    const origProjectEnd = runBackwardPass(sorted, taskMap, successors);

    const totalProjectCompression = origProjectEnd - totalTargetDays;

    if (totalProjectCompression <= 0) {
      // No compression needed — already at or under target
      // Leave original durations, forward pass already done
    } else {
      // ── Phase 2: Iterative critical-path crashing ──
      // Each iteration shaves 1 day off the project end by distributing
      // compression proportionally among critical tasks. This mirrors
      // standard CPM crash methodology: crash the critical path, re-run
      // CPM, repeat. We batch by 1-day increments for efficiency.
      //
      // Cap iterations to prevent infinite loops on degenerate schedules.
      const MAX_CRASH_ITERATIONS = Math.min(totalProjectCompression + 10, 500);

      for (let iter = 0; iter < MAX_CRASH_ITERATIONS; iter++) {
        // Check current project end
        const projEnd = Math.max(...Object.values(taskMap).map(t => t.earlyFinish));
        if (projEnd <= totalTargetDays) break; // target reached

        // Run backward pass to identify current critical path
        runBackwardPass(sorted, taskMap, successors);

        // Collect critical tasks (float ≤ 0) that still have crash capacity
        const crashable = [];
        let totalCrashCapacity = 0;
        Object.values(taskMap).forEach(t => {
          if (t.totalFloat > 0) return; // not critical — skip
          const minDays = Math.max(1, Math.ceil(t.origDays * otFloor));
          const remaining = t.newDays - minDays;
          if (remaining > 0) {
            crashable.push({ task: t, remaining, minDays });
            totalCrashCapacity += remaining;
          }
        });

        if (crashable.length === 0 || totalCrashCapacity === 0) break; // floor reached

        // How many project days do we still need to shave off?
        const overshoot = projEnd - totalTargetDays;

        // Distribute crash proportionally by each task's remaining capacity.
        // We crash by exactly 1 day per task (minimum meaningful increment)
        // to avoid over-shooting. For efficiency, when overshoot is large
        // relative to the number of crashable tasks, we can safely crash
        // each task by more than 1 day — but never more than proportional share.
        //
        // crashPerTask = max(1, round(task.remaining / totalCapacity * overshoot))
        // This ensures we don't overshoot on any single task while making
        // meaningful progress toward the target.
        let anyCompressed = false;
        crashable.forEach(({ task, remaining }) => {
          // Proportional share of the needed compression
          const proportionalShare = Math.round((remaining / totalCrashCapacity) * overshoot);
          // Crash by at least 1 day, at most the proportional share, at most remaining capacity
          const crash = Math.max(1, Math.min(proportionalShare, remaining));
          if (crash > 0) {
            task.newDays -= crash;
            anyCompressed = true;
          }
        });

        if (!anyCompressed) break;

        // Re-run forward pass with updated durations to see the new project end
        runForwardPass(sorted, taskMap, predecessors);
      }
    }

    // ── Phase 3: Final full CPM for accurate post-compression float & criticality ──
    runForwardPass(sorted, taskMap, predecessors);
    runBackwardPass(sorted, taskMap, successors);
  }

  // Project end in days → weeks
  const projEndDay = Math.max(...Object.values(taskMap).map(t => t.earlyFinish));
  const achievedWeeks = Math.max(4, Math.ceil(projEndDay / 7));

  // Aggregate hours into weekly buckets per discipline
  const hoursData = {};
  Object.values(taskMap).forEach(t => {
    const discId = t.discId;
    if (!discId) return;
    if (!hoursData[discId]) hoursData[discId] = new Array(achievedWeeks).fill(0);
    // Ensure array is big enough
    while (hoursData[discId].length < achievedWeeks) hoursData[discId].push(0);

    const taskDays = Math.max(1, t.newDays);
    const hoursPerDay = t.hours / taskDays;
    // Distribute hours across the task's new span, week by week
    for (let day = t.earlyStart; day < t.earlyFinish; day++) {
      const week = Math.floor(day / 7);
      if (week < achievedWeeks) {
        // Workday factor: 5/7 of days are workdays
        hoursData[discId][week] += hoursPerDay * (5 / 7);
      }
    }
  });

  // Round
  Object.keys(hoursData).forEach(k => {
    hoursData[k] = hoursData[k].map(h => Math.round(h));
  });

  // Build task-level bar data for Gantt display
  const taskBars = Object.values(taskMap).map(t => ({
    id: t.id,
    name: t.name,
    discipline: t.discipline,
    discId: t.discId,
    hours: t.hours,
    baseStartDay: t.startDay,
    baseEndDay: t.endDay,
    adjStartDay: t.earlyStart,
    adjEndDay: t.earlyFinish,
    origDays: t.origDays,
    newDays: t.newDays,
    isCritical: t.totalFloat <= 0,    // dynamic float from CPM, not static XER float
    isCompressed: t.newDays < t.origDays,
    totalFloat: Math.max(0, t.totalFloat), // post-compression float for tooltip display
  })).sort((a, b) => a.adjEndDay - b.adjEndDay || a.adjStartDay - b.adjStartDay);

  // Per-discipline compression ratios — aggregated from task-level compression
  // Used to compute per-discipline PF instead of a single global PF
  const discCompression = {};
  Object.values(taskMap).forEach(t => {
    if (!t.discId) return;
    if (!discCompression[t.discId]) discCompression[t.discId] = { origDays: 0, newDays: 0 };
    discCompression[t.discId].origDays += t.origDays;
    discCompression[t.discId].newDays += t.newDays;
  });
  Object.keys(discCompression).forEach(k => {
    const dc = discCompression[k];
    dc.ratio = dc.origDays > 0 ? dc.newDays / dc.origDays : 1.0;
  });

  return { hoursData, achievedWeeks, taskBars, otFloor, otWorkDays, discCompression };
}

// Get minimum achievable weeks using CPM at max OT compression
function getMinWeeksCPM(schedule, baseWeeks, otCap) {
  if (!schedule || otCap.factor <= 1) return baseWeeks;
  // Maximum task compression ratio = base capacity / OT capacity
  const minRatio = BASE_HRS_PER_WEEK / otCap.hrsPerWeek;
  const minTargetWeeks = Math.max(4, Math.ceil(baseWeeks * minRatio));
  // Determine otMode from capacity
  const otMode = otCap.hrsPerWeek >= 70 ? "satSun" : otCap.hrsPerWeek >= 60 ? "sat" : "none";
  const result = compressByCPM(schedule, minTargetWeeks, baseWeeks, otMode);
  // CPM may produce a longer schedule than the simple ratio suggests
  // because logic links constrain how much the critical path can compress
  return result ? Math.max(result.achievedWeeks, minTargetWeeks) : minTargetWeeks;
}

// Minimum project weeks — uses CPM when schedule available, else capacity formula.
function getMinWeeks(baseWeeks, otCap, hoursData, schedule) {
  if (otCap.factor <= 1) return baseWeeks;
  if (schedule && schedule.activities && schedule.activities.length > 0) {
    return getMinWeeksCPM(schedule, baseWeeks, otCap);
  }
  return Math.max(Math.ceil(baseWeeks * BASE_HRS_PER_WEEK / otCap.hrsPerWeek), 4);
}

// ═══════════════════════════════════════════════════════════════════════
// MCAA Bulletin OT1 Revised (2011) — Cumulative OT Fatigue Tables
// Averaged from BRT (1980), NECA (1989), Thomas/Penn State (1997), US Army COE (1979)
// PI = Productivity Index where 1.0 = no loss. Decreases with consecutive OT weeks.
// Source: Hanna, Sullivan (2004); Hanna, Taylor, Sullivan (2005) ASCE JCEM
// ═══════════════════════════════════════════════════════════════════════
const MCAA_PI = {
  // 60 hrs/wk (5×10 base + Sat OT) — 6-10 schedule, BRT/NECA/Thomas/COE average
  60: [1.00, 0.95, 0.93, 0.91, 0.89, 0.87, 0.85, 0.83, 0.80, 0.76, 0.72, 0.70, 0.68,
       0.66, 0.64, 0.63, 0.62],
  // 70 hrs/wk (5×10 base + Sat+Sun OT) — 7-10 schedule, BRT/NECA/Thomas/COE average
  70: [1.00, 0.88, 0.84, 0.80, 0.75, 0.70, 0.65, 0.61, 0.57, 0.53, 0.48, 0.44, 0.41,
       0.38, 0.36, 0.34, 0.33],
};

// Get MCAA Productivity Index for a given OT mode and consecutive OT week number (1-based).
// For weeks beyond table range, extrapolates using the last two data points' trend.
function getMCAAFatigue(otMode, consecutiveWeek) {
  if (otMode === "none" || consecutiveWeek <= 0) return 1.0;
  const table = otMode === "sat" ? MCAA_PI[60] : MCAA_PI[70];
  if (consecutiveWeek < table.length) return table[consecutiveWeek];
  // Extrapolate: continue the decay rate from last two points, with floor of 0.35
  const last = table[table.length - 1];
  const prev = table[table.length - 2];
  const decay = prev - last; // positive number
  const extra = consecutiveWeek - (table.length - 1);
  return Math.max(0.35, last - decay * extra);
}

// ═══════════════════════════════════════════════════════════════════════
// Non-Linear Productivity Factor (S-curve / Power Curve)
// Based on BRT (1980) and Thomas (1997) empirical data showing:
//   - First ~20% of compression: minimal PF loss (workers absorb slack)
//   - Middle 20-70%: moderate, accelerating loss
//   - Beyond 70%: severe, steep loss
// Modeled as power curve: PF = 1 - (1 - ACCEL_PF) × compressionFrac^α
// α = 1.8 fitted to BRT/MCAA empirical curves (R² ≈ 0.94 vs averaged data)
// ═══════════════════════════════════════════════════════════════════════
const PF_CURVE_ALPHA = 1.8; // Power exponent: >1 = convex (late loss matches BRT data)
const ACCEL_PF = 0.85;      // Max PF loss at full compression (BRT empirical: 15% loss)
const EXTENSION_PF = 1.0;   // No productivity gain from extension (BRT/MCAA: negligible)

function getNonLinearPF(w, baseWeeks, otCap, hoursData) {
  if (w >= baseWeeks || otCap.factor <= 1) return 1.0;
  // Use ABSOLUTE compression range: physical limit is 7-day work week (5/7 ratio).
  // This ensures the same number of weeks compressed produces the same PF
  // regardless of OT mode. Previously, PF used the mode-specific min weeks which
  // caused Sat OT at 1-week compression to get 100% penalty (range=1) while
  // Sat+Sun at 1-week compression got 50% penalty (range=2) — incorrect because
  // the physical disruption from 1-week compression is identical.
  const absoluteMinWeeks = Math.max(4, Math.ceil(baseWeeks * 5 / 7));
  const range = baseWeeks - absoluteMinWeeks;
  if (range <= 0) return 1.0;
  const compressionFrac = Math.min(1, (baseWeeks - w) / range);
  // Power curve: gentle at low compression, steep at high
  const nonLinearFrac = Math.pow(compressionFrac, PF_CURVE_ALPHA);
  return 1.0 + (ACCEL_PF - 1.0) * nonLinearFrac;
}

// Per-discipline PF from CPM task-level compression data.
// Each discipline's PF is based on how much its own tasks were actually compressed,
// rather than applying a single global PF to all disciplines uniformly.
// A discipline with no compressed tasks (ratio=1.0) gets PF=1.0 (no penalty).
function getPerDisciplinePF(discCompression) {
  if (!discCompression) return {};
  // Maximum compression ratio achievable: 5/7 (every day becomes a work day)
  const maxCompressionRatio = 5 / 7;
  const range = 1.0 - maxCompressionRatio; // ~0.286
  const pfMap = {};
  Object.keys(discCompression).forEach(discId => {
    const { ratio } = discCompression[discId];
    if (ratio >= 1.0) {
      pfMap[discId] = 1.0; // no compression → no penalty
    } else {
      // Map ratio to compression fraction: 1.0→0 (none), maxRatio→1 (full)
      const compressionFrac = Math.min(1, (1.0 - ratio) / range);
      const nonLinearFrac = Math.pow(compressionFrac, PF_CURVE_ALPHA);
      pfMap[discId] = 1.0 + (ACCEL_PF - 1.0) * nonLinearFrac;
    }
  });
  return pfMap;
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Stacking Penalty
// Based on Hanna et al. (2007) ASCE JCEM: 0-41% productivity loss from overmanning.
// MCAA Factor Model: Stacking of Trades = congestion when multiple trades share space.
// Model: penalty = STACKING_K × (activeTrades - 1) × normalizedDensity
// where normalizedDensity = weekHours / baselineAvgWeekHours
// Capped at STACKING_MAX per MCAA severe range.
// IMPORTANT: Only the INCREMENTAL stacking beyond the base plan is penalized.
// Base-plan stacking is already embedded in the original budget.
// ═══════════════════════════════════════════════════════════════════════
const STACKING_K = 0.03;     // 3% penalty per additional concurrent trade beyond 1
const STACKING_MAX = 0.25;   // Cap at 25% (MCAA "average" range for stacking)

function computeStackingPenaltiesForDuration(hoursData, baseWeeks, targetWeeks, preAdjusted) {
  const keys = Object.keys(hoursData).filter(k => hoursData[k] && hoursData[k].length > 0);
  if (keys.length <= 1) return null;

  const adjustedByDisc = {};
  keys.forEach(k => {
    adjustedByDisc[k] = (preAdjusted && preAdjusted[k]) || redistributeHours(hoursData[k], baseWeeks, targetWeeks);
  });

  const baseAvg = keys.reduce((s, k) => {
    const total = hoursData[k].reduce((a, h) => a + h, 0);
    return s + total / baseWeeks;
  }, 0);
  if (baseAvg <= 0) return null;

  const penalties = new Array(targetWeeks).fill(0);
  for (let w = 0; w < targetWeeks; w++) {
    let activeTrades = 0;
    let totalHours = 0;
    keys.forEach(k => {
      const h = adjustedByDisc[k][w] || 0;
      if (h > 0) { activeTrades++; totalHours += h; }
    });
    if (activeTrades <= 1) continue;
    const density = totalHours / baseAvg;
    penalties[w] = Math.min(STACKING_MAX,
      STACKING_K * (activeTrades - 1) * Math.max(1, density));
  }
  return penalties;
}

function computeStackingPenalties(hoursData, baseWeeks, targetWeeks, preAdjusted) {
  const keys = Object.keys(hoursData).filter(k => hoursData[k] && hoursData[k].length > 0);
  if (keys.length <= 1) return null;

  // If no compression/extension, no incremental stacking
  if (targetWeeks === baseWeeks && !preAdjusted) return null;

  // Compute raw stacking at target duration
  const adjPenalties = computeStackingPenaltiesForDuration(hoursData, baseWeeks, targetWeeks, preAdjusted);
  if (!adjPenalties) return null;

  // Compute raw stacking at baseline duration
  const basePenalties = computeStackingPenaltiesForDuration(hoursData, baseWeeks, baseWeeks);

  // Compute weighted-average baseline penalty to subtract as the "already priced" portion
  let baseAvgPenalty = 0;
  if (basePenalties) {
    const sum = basePenalties.reduce((s, p) => s + p, 0);
    const nonZero = basePenalties.filter(p => p > 0).length;
    baseAvgPenalty = nonZero > 0 ? sum / nonZero : 0;
  }

  // Net penalty = incremental stacking beyond baseline average
  const netPenalties = new Array(targetWeeks).fill(0);
  for (let w = 0; w < targetWeeks; w++) {
    netPenalties[w] = Math.max(0, adjPenalties[w] - baseAvgPenalty);
  }

  // If all net penalties are zero, return null
  if (netPenalties.every(p => p === 0)) return null;
  return netPenalties;
}

// ═══════════════════════════════════════════════════════════════════════
// Risk Band Multipliers
// Simple sensitivity-based approach: vary key parameters to generate
// P50 (base), P80 (+pessimistic), P90 (+very pessimistic) bands.
// Based on typical construction cost estimate contingency ranges (AACE RP 42R-08).
// ═══════════════════════════════════════════════════════════════════════
const RISK_BANDS = {
  P50: { pfScale: 1.0,  fatigueScale: 1.0,  stackScale: 1.0,  label: "P50 (Expected)" },
  P80: { pfScale: 1.25, fatigueScale: 1.15, stackScale: 1.20, label: "P80" },
  P90: { pfScale: 1.50, fatigueScale: 1.30, stackScale: 1.40, label: "P90" },
};

// ═══════════════════════════════════════════════════════════════════════
// Enhanced Cost Computation with MCAA Fatigue + Stacking
// Replaces computeWeeklyOtCost for the main forecast.
// ═══════════════════════════════════════════════════════════════════════
function computeEnhancedCost(origHours, baseRate, otRate, otMode, baseWeeks, targetWeeks,
                              compressionPF, stackingPenalties, riskBand, preAdjHours, applyOt = true) {
  if (targetWeeks === baseWeeks && otMode === "none" && !stackingPenalties && !preAdjHours)
    return origHours.reduce((s, h) => s + h, 0) * baseRate;

  const adjHours = preAdjHours || redistributeHours(origHours, baseWeeks, targetWeeks);
  const numOtWeeks = getOtWeeks(targetWeeks, baseWeeks, otMode);
  const otStartWeek = targetWeeks - numOtWeeks;
  const band = riskBand || RISK_BANDS.P50;

  let cost = 0;
  for (let w = 0; w < targetWeeks; w++) {
    // When applyOt=false (task-specific mode, non-compressed discipline), use base rate only
    const rate = applyOt
      ? getWeekRate(baseRate, otRate, otMode, w, targetWeeks, baseWeeks)
      : baseRate;
    const hours = adjHours[w] || 0;

    // 1. Base compression penalty (non-linear PF)
    let weekMultiplier = 1 / compressionPF;

    // 2. MCAA cumulative OT fatigue — only when this discipline is working OT
    if (applyOt && otMode !== "none" && w >= otStartWeek && numOtWeeks > 0) {
      const consecutiveOtWeek = w - otStartWeek + 1;
      const mcaaPI = getMCAAFatigue(otMode, consecutiveOtWeek);
      // Scale fatigue by risk band
      const scaledPI = 1.0 - (1.0 - mcaaPI) * band.fatigueScale;
      weekMultiplier *= (1 / Math.max(0.35, scaledPI));
    }

    // 3. Trade stacking penalty
    if (stackingPenalties && stackingPenalties[w] > 0) {
      weekMultiplier *= (1 + stackingPenalties[w] * band.stackScale);
    }

    cost += hours * rate * weekMultiplier;
  }
  return cost;
}

// Get per-week cost details for chart/tooltip use
function getWeekCostDetail(origHours, baseRate, otRate, otMode, baseWeeks, targetWeeks,
                            compressionPF, stackingPenalties, week, applyOt = true) {
  const adjHours = redistributeHours(origHours, baseWeeks, targetWeeks);
  const numOtWeeks = getOtWeeks(targetWeeks, baseWeeks, otMode);
  const otStartWeek = targetWeeks - numOtWeeks;
  const rate = applyOt
    ? getWeekRate(baseRate, otRate, otMode, week, targetWeeks, baseWeeks)
    : baseRate;
  const hours = adjHours[week] || 0;
  let weekMultiplier = 1 / compressionPF;

  let mcaaPI = 1.0;
  if (applyOt && otMode !== "none" && week >= otStartWeek && numOtWeeks > 0) {
    const consecutiveOtWeek = week - otStartWeek + 1;
    mcaaPI = getMCAAFatigue(otMode, consecutiveOtWeek);
    weekMultiplier *= (1 / mcaaPI);
  }

  let stackPenalty = 0;
  if (stackingPenalties && stackingPenalties[week] > 0) {
    stackPenalty = stackingPenalties[week];
    weekMultiplier *= (1 + stackPenalty);
  }

  return { hours, rate, weekMultiplier, mcaaPI, stackPenalty, cost: hours * rate * weekMultiplier };
}

function formatCurrency(value) {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatNumber(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Snap a date to the next Sunday (or same day if already Sunday).
// All week-ending dates in the app should fall on a Sunday. Mutates in place.
function snapToSunday(d) {
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  if (day !== 0) d.setDate(d.getDate() + (7 - day));
  return d;
}

// Inject global CSS to hide native number spinners
if (typeof document !== "undefined" && !document.getElementById("hide-spinners")) {
  const style = document.createElement("style");
  style.id = "hide-spinners";
  style.textContent = `
    input[type=number]::-webkit-inner-spin-button,
    input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
  `;
  document.head.appendChild(style);
}

// Custom stepper input — replaces native number spinners
function StepperInput({ value, onChange, step = 1, min, max, width = 80, disabled = false, color, label, hint, format }) {
  const COLORS = useColors();
  const displayValue = format ? format(value) : value;
  const canDecrement = min === undefined || value - step >= min - 0.001;
  const canIncrement = max === undefined || value + step <= max + 0.001;

  const btnStyle = (enabled) => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26, border: `1px solid ${enabled && !disabled ? COLORS.borderLight : COLORS.border}`,
    borderRadius: 4, background: enabled && !disabled ? COLORS.surfaceAlt : "transparent",
    color: enabled && !disabled ? COLORS.textDim : COLORS.border,
    cursor: enabled && !disabled ? "pointer" : "default",
    fontFamily: FONT, fontSize: 14, fontWeight: 600, lineHeight: 1,
    transition: "all 0.15s", userSelect: "none",
    opacity: disabled ? 0.35 : 1,
  });

  const handleStep = (direction) => {
    if (disabled) return;
    const newVal = Math.round((value + direction * step) * 1000) / 1000;
    if (min !== undefined && newVal < min) return;
    if (max !== undefined && newVal > max) return;
    onChange(newVal);
  };

  return (
    <div style={{ textAlign: "center", opacity: disabled ? 0.35 : 1, transition: "opacity 0.2s" }}>
      {label && <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", marginTop: label ? 4 : 0 }}>
        <button
          type="button"
          aria-label="Decrement"
          disabled={disabled || !canDecrement}
          style={btnStyle(canDecrement)}
          onClick={() => handleStep(-1)}
          onMouseEnter={(e) => { if (canDecrement && !disabled) { e.currentTarget.style.background = COLORS.border; e.currentTarget.style.color = COLORS.text; }}}
          onMouseLeave={(e) => { e.currentTarget.style.background = canDecrement && !disabled ? COLORS.surfaceAlt : "transparent"; e.currentTarget.style.color = canDecrement && !disabled ? COLORS.textDim : COLORS.border; }}
        >−</button>
        <input
          style={{
            background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 4,
            padding: "4px 6px", color: color || COLORS.text, fontFamily: FONT, fontSize: 15,
            fontWeight: 700, textAlign: "center", outline: "none", width,
            boxSizing: "border-box",
          }}
          type="number" step={step} min={min} max={max} value={value} disabled={disabled}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        />
        <button
          type="button"
          aria-label="Increment"
          disabled={disabled || !canIncrement}
          style={btnStyle(canIncrement)}
          onClick={() => handleStep(1)}
          onMouseEnter={(e) => { if (canIncrement && !disabled) { e.currentTarget.style.background = COLORS.border; e.currentTarget.style.color = COLORS.text; }}}
          onMouseLeave={(e) => { e.currentTarget.style.background = canIncrement && !disabled ? COLORS.surfaceAlt : "transparent"; e.currentTarget.style.color = canIncrement && !disabled ? COLORS.textDim : COLORS.border; }}
        >+</button>
      </div>
      {hint && <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function getStyles(COLORS) { return {
  container: { background: COLORS.bg, color: COLORS.text, fontFamily: FONT, minHeight: "100vh", fontSize: 13, display: "flex", flexDirection: "row" },
  sidebar: { display: "flex", flexDirection: "column", gap: 0, borderRight: `1px solid ${COLORS.border}`, padding: "0 0 16px", minWidth: SIDEBAR_WIDTH, width: SIDEBAR_WIDTH, position: "sticky", top: 0, alignSelf: "flex-start", height: "100vh", overflowY: "auto", background: COLORS.bg, borderLeft: `3px solid ${COLORS.accent}`, flexShrink: 0, transition: "width 0.2s, min-width 0.2s" },
  mainContent: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  header: { padding: "0 28px", height: 52, borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end" },
  title: { fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: COLORS.text },
  subtitle: { fontFamily: FONT, fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.5px", marginTop: 2 },
  tabs: { display: "flex", flexDirection: "column", gap: 0 },
  tab: (active) => ({
    padding: "10px 20px",
    cursor: "pointer",
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    fontWeight: active ? 700 : 500,
    color: active ? COLORS.accent : COLORS.textDim,
    borderLeft: active ? `3px solid ${COLORS.accent}` : "3px solid transparent",
    background: active ? COLORS.bg : "transparent",
    transition: "all 0.2s",
    whiteSpace: "nowrap",
  }),
  body: { padding: "20px 28px", flex: 1, minWidth: 0 },
  card: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "18px 20px", marginBottom: 16 },
  cardTitle: { fontFamily: DISPLAY_FONT, fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: COLORS.textDim, marginBottom: 14 },
  row: { display: "flex", gap: 16, flexWrap: "wrap" },
  input: {
    background: COLORS.surfaceAlt,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    padding: "8px 12px",
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  label: { fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4, display: "block" },
  btn: (variant = "default") => ({
    padding: "8px 18px",
    borderRadius: 4,
    border: variant === "primary" ? "none" : `1px solid ${COLORS.border}`,
    background: variant === "primary" ? COLORS.accent : "transparent",
    color: variant === "primary" ? COLORS.bg : COLORS.textDim,
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "all 0.2s",
  }),
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: COLORS.textDim, fontWeight: 600 },
  td: { padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}22` },
  slider: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    appearance: "none",
    background: `linear-gradient(to right, ${COLORS.green}, ${COLORS.accent}, ${COLORS.red})`,
    outline: "none",
    cursor: "pointer",
  },
  metric: (color) => ({
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: "14px 18px",
    flex: "1 1 180px",
    borderLeft: `3px solid ${color}`,
  }),
  metricValue: { fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 700, color: COLORS.text, lineHeight: 1.1 },
  metricLabel: { fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 4 },
  metricDelta: (positive) => ({ fontSize: 12, color: positive ? COLORS.green : COLORS.red, marginTop: 2, fontWeight: 600 }),
}; }

function getSliderCSS(COLORS) { return `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: ${COLORS.accent};
    border: 3px solid ${COLORS.bg};
    box-shadow: 0 0 8px rgba(245,158,11,0.5);
    cursor: pointer;
  }
  input[type="range"]::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: ${COLORS.accent};
    border: 3px solid ${COLORS.bg};
    box-shadow: 0 0 8px rgba(245,158,11,0.5);
    cursor: pointer;
  }
  .hours-cell:focus {
    outline: 2px solid ${COLORS.accent};
    outline-offset: -2px;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
  textarea { resize: vertical; }
  button {
    transition: all 0.15s ease !important;
    position: relative;
  }
  button:hover:not(:disabled) {
    background-color: ${COLORS.accent}22 !important;
    border-color: ${COLORS.accent}66 !important;
    color: ${COLORS.text} !important;
    box-shadow: 0 2px 8px ${COLORS.accent}25;
    transform: translateY(-1px);
  }
  button:active:not(:disabled) {
    transform: translateY(0px);
    background-color: ${COLORS.accent}35 !important;
    box-shadow: 0 1px 2px ${COLORS.accent}20;
  }
  button:focus-visible {
    outline: 2px solid ${COLORS.accent};
    outline-offset: 2px;
    z-index: 1;
  }
  input:focus-visible {
    outline: 2px solid ${COLORS.accent};
    outline-offset: -1px;
  }
  input[type="range"]:focus-visible {
    outline: 2px solid ${COLORS.accent};
    outline-offset: 4px;
  }
  .nav-tab {
    transition: all 0.15s ease;
  }
  .nav-tab:hover {
    background: ${COLORS.accent}12 !important;
    color: ${COLORS.text} !important;
    border-left-color: ${COLORS.accent}88 !important;
  }
  .nav-tab:focus-visible {
    outline: 2px solid ${COLORS.accent};
    outline-offset: -2px;
    background: ${COLORS.accent}12 !important;
  }
  .drop-zone:focus-visible {
    outline: 2px solid ${COLORS.accent};
    outline-offset: 2px;
  }
  *:focus:not(:focus-visible) {
    outline: none;
  }
  @media (max-width: 1100px) {
    .crunch-sidebar { min-width: 52px !important; width: 52px !important; }
    .crunch-sidebar .sidebar-brand-text { display: none !important; }
    .crunch-sidebar .nav-tab span.tab-label { display: none !important; }
    .crunch-sidebar .nav-tab { justify-content: center; padding-left: 0 !important; padding-right: 0 !important; }
    .crunch-sticky-bar { left: 52px !important; }
  }
  @media (max-width: 800px) {
    .crunch-sidebar { display: none !important; }
    .crunch-mobile-tabs { display: flex !important; }
    .crunch-sticky-bar { left: 0 !important; }
  }
  .crunch-mobile-tabs { display: none; }
`; }

function SetupTab({ disciplines, setDisciplines, timeCosts, setTimeCosts }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);
  const addDiscipline = () => {
    const id = Math.max(0, ...disciplines.map((d) => d.id)) + 1;
    setDisciplines([...disciplines, { id, name: "", rate: 0, otRate: 0 }]);
  };
  const removeDiscipline = (id) => setDisciplines(disciplines.filter((d) => d.id !== id));
  const updateDiscipline = (id, field, value) =>
    setDisciplines(disciplines.map((d) => (d.id === id ? { ...d, [field]: (field === "rate" || field === "otRate") ? parseFloat(value) || 0 : value } : d)));

  const addTimeCost = () => {
    const id = Math.max(0, ...timeCosts.map((t) => t.id)) + 1;
    setTimeCosts([...timeCosts, { id, name: "", basis: "monthly", rate: 0 }]);
  };
  const removeTimeCost = (id) => setTimeCosts(timeCosts.filter((t) => t.id !== id));
  const updateTimeCost = (id, field, value) =>
    setTimeCosts(timeCosts.map((t) => (t.id === id ? { ...t, [field]: field === "rate" ? parseFloat(value) || 0 : value } : t)));

  return (
    <div>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>Disciplines</div>
          <button style={styles.btn("primary")} onClick={addDiscipline}>+ Add Discipline</button>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 40 }}>#</th>
              <th style={styles.th}>Discipline Name</th>
              <th style={{ ...styles.th, width: 140 }}>Blended $/Hr</th>
              <th style={{ ...styles.th, width: 140 }}>OT $/Hr</th>
              <th style={{ ...styles.th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {disciplines.map((d, i) => (
              <tr key={d.id}>
                <td style={{ ...styles.td, color: COLORS.textMuted }}>{i + 1}</td>
                <td style={styles.td}>
                  <input style={styles.input} value={d.name} onChange={(e) => updateDiscipline(d.id, "name", e.target.value)} placeholder="Discipline name..." />
                </td>
                <td style={styles.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: COLORS.textMuted }}>$</span>
                    <input style={{ ...styles.input, textAlign: "right" }} type="number" value={d.rate || ""} onChange={(e) => updateDiscipline(d.id, "rate", e.target.value)} />
                  </div>
                </td>
                <td style={styles.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: COLORS.textMuted }}>$</span>
                    <input style={{ ...styles.input, textAlign: "right" }} type="number" value={d.otRate || ""} onChange={(e) => updateDiscipline(d.id, "otRate", e.target.value)} placeholder="1.5×" />
                  </div>
                </td>
                <td style={styles.td}>
                  <button style={{ ...styles.btn(), padding: "4px 10px", color: COLORS.red, borderColor: COLORS.redDim }} onClick={() => removeDiscipline(d.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>Time-Based Costs</div>
          <button style={styles.btn("primary")} onClick={addTimeCost}>+ Add Cost</button>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 40 }}>#</th>
              <th style={styles.th}>Description</th>
              <th style={{ ...styles.th, width: 130 }}>Rate Basis</th>
              <th style={{ ...styles.th, width: 150 }}>Rate Amount</th>
              <th style={{ ...styles.th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {timeCosts.map((t, i) => (
              <tr key={t.id}>
                <td style={{ ...styles.td, color: COLORS.textMuted }}>{i + 1}</td>
                <td style={styles.td}>
                  <input style={styles.input} value={t.name} onChange={(e) => updateTimeCost(t.id, "name", e.target.value)} placeholder="Cost description..." />
                </td>
                <td style={styles.td}>
                  <select style={{ ...styles.input, cursor: "pointer" }} value={t.basis} onChange={(e) => updateTimeCost(t.id, "basis", e.target.value)}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </td>
                <td style={styles.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: COLORS.textMuted }}>$</span>
                    <input style={{ ...styles.input, textAlign: "right" }} type="number" value={t.rate || ""} onChange={(e) => updateTimeCost(t.id, "rate", e.target.value)} />
                  </div>
                </td>
                <td style={styles.td}>
                  <button style={{ ...styles.btn(), padding: "4px 10px", color: COLORS.red, borderColor: COLORS.redDim }} onClick={() => removeTimeCost(t.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoursTab({ disciplines, setDisciplines, hoursData, setHoursData, baseWeeks, setBaseWeeks, startDate, setStartDate, setWeekOffset, setDisciplinePFs, xerSchedule, setXerSchedule }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [xerSummary, setXerSummary] = useState(null);
  const [xerError, setXerError] = useState(null);
  const [xerDragOver, setXerDragOver] = useState(false);
  const [scheduleCollapsed, setScheduleCollapsed] = useState({});
  const [scheduleHover, setScheduleHover] = useState(null);
  const fileInputRef = useRef(null);

  // Detect auto-loaded XER schedule and populate summary for display
  useEffect(() => {
    if (xerSchedule && !xerSummary) {
      setXerSummary({
        taskCount: xerSchedule.activities?.length || 0,
        assignmentCount: 0,
        totalHours: Object.values(hoursData).reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0),
        disciplineCount: disciplines.length,
        projectName: "Pump House-1",
        projectCount: 1,
        totalTasksInFile: xerSchedule.activities?.length || 0,
        skipped: { proj: 0, wbs: 0, loe: 0, dates: 0 },
        totalRsrcInFile: 0,
        fileName: "Pump House-1.xer (default)",
        groupBy: "resource",
      });
    }
  }, [xerSchedule]);

  const handleXerImport = (text, fileName) => {
    try {
      setXerError(null);
      const result = processXER(text);
      // Apply to app state
      setDisciplines(result.disciplines);
      setHoursData(result.hoursData);
      setBaseWeeks(result.baseWeeks);
      setStartDate(result.startDate);
      setWeekOffset(0);
      setDisciplinePFs({});
      setXerSummary({ ...result.summary, fileName, groupBy: result.groupBy });
      setXerSchedule(result.schedule || null);
      setScheduleCollapsed({});
    } catch (e) {
      setXerError(e.message || 'Failed to parse XER file');
      setXerSummary(null);
      setXerSchedule(null);
    }
  };

  const onFileSelected = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => handleXerImport(e.target.result, file.name);
    reader.onerror = () => setXerError('Failed to read file');
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setXerDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileSelected(file);
  };

  const handleResetToDemo = () => {
    // Re-load default XER schedule (Pump House-1)
    fetch("Pump House-1.xer")
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.text(); })
      .then(text => {
        try {
          const result = processXER(text);
          setDisciplines(result.disciplines);
          setHoursData(result.hoursData);
          setBaseWeeks(result.baseWeeks);
          setStartDate(result.startDate);
          setWeekOffset(0);
          setDisciplinePFs({});
          setXerSummary({ ...result.summary, fileName: "Pump House-1.xer", groupBy: result.groupBy });
          setXerError(null);
          setXerSchedule(result.schedule || null);
          setScheduleCollapsed({});
        } catch (e) {
          // Fallback to hardcoded if parse fails
          setDisciplines(defaultDisciplines);
          setHoursData(defaultHoursData);
          setBaseWeeks(NUM_WEEKS);
          setStartDate("2024-09-23");
          setWeekOffset(0);
          setDisciplinePFs({});
          setXerSummary(null);
          setXerError(null);
          setXerSchedule(null);
        }
      })
      .catch(() => {
        // Fallback to hardcoded defaults if fetch fails
        setDisciplines(defaultDisciplines);
        setHoursData(defaultHoursData);
        setBaseWeeks(NUM_WEEKS);
        setStartDate("2024-09-23");
        setWeekOffset(0);
        setDisciplinePFs({});
        setXerSummary(null);
        setXerError(null);
        setXerSchedule(null);
      });
  };

  const updateHours = (discId, weekIdx, value) => {
    const newData = { ...hoursData };
    if (!newData[discId]) newData[discId] = new Array(baseWeeks).fill(0);
    newData[discId] = [...newData[discId]];
    newData[discId][weekIdx] = parseInt(value) || 0;
    setHoursData(newData);
  };

  const handlePaste = () => {
    try {
      const lines = pasteText.trim().split("\n");
      if (lines.length < 2) return;
      const headers = lines[0].split("\t");
      const discNames = headers.slice(1);
      const newData = {};
      const numWeeks = lines.length - 1;

      disciplines.forEach((d) => {
        const colIdx = discNames.findIndex((n) => n.trim().toLowerCase() === d.name.trim().toLowerCase());
        newData[d.id] = [];
        for (let w = 0; w < numWeeks; w++) {
          const cols = lines[w + 1].split("\t");
          newData[d.id].push(colIdx >= 0 ? parseInt(cols[colIdx + 1]) || 0 : 0);
        }
      });

      setBaseWeeks(numWeeks);
      setHoursData(newData);
      setPasteMode(false);
      setPasteText("");
    } catch (e) {
      alert("Error parsing data. Ensure tab-separated format with header row.");
    }
  };

  const weeksArray = Array.from({ length: baseWeeks }, (_, i) => i);
  const visibleRange = 52;
  const [scrollStart, setScrollStart] = useState(0);
  const [baseGanttHover, setBaseGanttHover] = useState(null);
  const visibleWeeks = weeksArray.slice(scrollStart, scrollStart + visibleRange);

  return (
    <div>
      {/* XER Import Section */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={styles.cardTitle}>Schedule Import</div>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: -8 }}>
              Import a Primavera P6 XER file to populate disciplines and weekly hours, or use demo data.
            </div>
          </div>
          <button style={{ ...styles.btn("default"), fontSize: 11 }} onClick={handleResetToDemo}>
            Reset to Default
          </button>
        </div>

        {/* Drop zone */}
        <div
          className="drop-zone"
          role="button"
          tabIndex={0}
          aria-label="Import XER schedule file"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); }}}
          onDragOver={(e) => { e.preventDefault(); setXerDragOver(true); }}
          onDragLeave={() => setXerDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${xerDragOver ? COLORS.accent : COLORS.border}`,
            borderRadius: 8,
            padding: xerSummary ? "12px 20px" : "24px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: xerDragOver ? `${COLORS.accent}08` : "transparent",
            transition: "all 0.15s",
            marginBottom: xerSummary || xerError ? 12 : 0,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xer"
            style={{ display: "none" }}
            onChange={(e) => { onFileSelected(e.target.files?.[0]); e.target.value = ''; }}
          />
          {xerSummary ? (
            <div style={{ fontSize: 12, color: COLORS.textDim }}>
              Drop a new .xer file or click to replace
            </div>
          ) : (
            <>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📋</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>
                Drop XER file here or click to browse
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Primavera P6 .xer export — disciplines, hours, and dates will be auto-detected
              </div>
            </>
          )}
        </div>

        {/* Import summary */}
        {xerSummary && (
          <div style={{
            background: `${COLORS.green}10`,
            border: `1px solid ${COLORS.green}33`,
            borderRadius: 6,
            padding: "12px 16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ color: COLORS.green, fontSize: 14 }}>✓</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.text }}>{xerSummary.projectName}</span>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>({xerSummary.fileName})</span>
              {xerSummary.projectCount > 1 && (
                <span style={{ fontSize: 10, color: COLORS.orange, fontWeight: 600 }}>
                  {xerSummary.projectCount} projects in file — largest selected
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 11, color: COLORS.textDim }}>
              <span><strong>{xerSummary.taskCount}</strong> activities</span>
              <span><strong>{xerSummary.assignmentCount}</strong> resource assignments</span>
              <span><strong>{formatNumber(xerSummary.totalHours)}</strong> total hours</span>
              <span><strong>{xerSummary.disciplineCount}</strong> disciplines</span>
              <span><strong>{baseWeeks}</strong> weeks</span>
              <span>Grouped by: <strong>{xerSummary.groupBy === 'activityCode' ? 'Activity Code' : xerSummary.groupBy === 'wbs' ? 'WBS' : 'Resource'}</strong></span>
            </div>
            {(xerSummary.totalTasksInFile > xerSummary.taskCount + 5) && (
              <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>
                Parsed {xerSummary.taskCount} of {xerSummary.totalTasksInFile} total tasks
                {xerSummary.skipped.proj > 0 && ` · ${xerSummary.skipped.proj} other-project`}
                {xerSummary.skipped.wbs > 0 && ` · ${xerSummary.skipped.wbs} WBS summaries`}
                {xerSummary.skipped.loe > 0 && ` · ${xerSummary.skipped.loe} LOE`}
                {xerSummary.skipped.dates > 0 && ` · ${xerSummary.skipped.dates} invalid dates`}
                {xerSummary.totalRsrcInFile > xerSummary.assignmentCount + 5 && ` · ${xerSummary.totalRsrcInFile - xerSummary.assignmentCount} resource assignments filtered`}
              </div>
            )}
            <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 6 }}>
              Discipline rates default to $75/hr — adjust in the Setup tab. Hours and dates are editable below.
            </div>
          </div>
        )}

        {/* Error */}
        {xerError && (
          <div style={{
            background: `${COLORS.red}10`,
            border: `1px solid ${COLORS.red}33`,
            borderRadius: 6,
            padding: "10px 16px",
            fontSize: 12,
            color: COLORS.red,
          }}>
            <strong>Import error:</strong> {xerError}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>Forecast Hours by Week</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div>
              <label style={styles.label}>Project Start</label>
              <input style={{ ...styles.input, width: 150 }} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <StepperInput
                value={baseWeeks} step={1} min={4} max={260} width={60}
                label="Total Weeks"
                onChange={(nw) => {
                  setBaseWeeks(nw);
                  const newData = {};
                  disciplines.forEach((d) => {
                    const old = hoursData[d.id] || [];
                    newData[d.id] = Array.from({ length: nw }, (_, i) => i < old.length ? old[i] : 0);
                  });
                  setHoursData(newData);
                }}
              />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button style={styles.btn(pasteMode ? "primary" : "default")} onClick={() => setPasteMode(!pasteMode)}>
                {pasteMode ? "Cancel" : "Paste from Excel"}
              </button>
            </div>
          </div>
        </div>

        {pasteMode && (
          <div style={{ marginBottom: 16, padding: 14, background: COLORS.surfaceAlt, borderRadius: 4, border: `1px solid ${COLORS.accentDim}` }}>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 8 }}>
              Paste tab-separated data from Excel. First row should be headers: <span style={{ color: COLORS.accent }}>Week | Discipline1 | Discipline2 | ...</span>
              <br />Discipline names must match the names defined in Setup.
            </div>
            <textarea
              style={{ ...styles.input, height: 120, fontFamily: FONT, fontSize: 12 }}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Week\tCivil\tElectrical\tInstrumentation\tMechanical\tPiping\n1\t459\t0\t0\t0\t0\n2\t262\t0\t0\t0\t437\n..."}
            />
            <button style={{ ...styles.btn("primary"), marginTop: 8 }} onClick={handlePaste}>Import Data</button>
          </div>
        )}

        <div style={{ overflowX: "auto", maxHeight: 400 }}>
          <table style={{ ...styles.table, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...styles.th, position: "sticky", left: 0, background: COLORS.surface, zIndex: 3, minWidth: 160 }}>Discipline</th>
                {visibleWeeks.map((w) => {
                  const weekDate = new Date(startDate);
                  weekDate.setDate(weekDate.getDate() + w * 7); snapToSunday(weekDate);
                  const dateStr = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <th key={w} style={{ ...styles.th, minWidth: 72, textAlign: "center", padding: "6px 4px" }}>
                      <div style={{ fontWeight: 700 }}>Wk {w + 1}</div>
                      <div style={{ fontSize: 9, fontWeight: 400, color: COLORS.textMuted, marginTop: 1 }}>{dateStr}</div>
                    </th>
                  );
                })}
                <th style={{ ...styles.th, position: "sticky", right: 0, background: COLORS.surface, zIndex: 3, minWidth: 80, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {disciplines.map((d, di) => {
                const discTotal = (hoursData[d.id] || []).reduce((s, h) => s + h, 0);
                return (
                  <tr key={d.id} style={{ background: di % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}44` }}>
                    <td style={{ ...styles.td, position: "sticky", left: 0, background: di % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, fontWeight: 600, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: DISCIPLINE_COLORS[di % DISCIPLINE_COLORS.length], marginRight: 8, verticalAlign: "middle" }} />
                      {d.name}
                    </td>
                    {visibleWeeks.map((w) => (
                      <td key={w} style={{ ...styles.td, padding: "4px 2px" }}>
                        <input
                          className="hours-cell"
                          style={{ ...styles.input, textAlign: "right", padding: "4px 6px", width: 68, background: ((hoursData[d.id] || [])[w] || 0) > 0 ? COLORS.surfaceAlt : "transparent" }}
                          type="number"
                          min={0}
                          value={(hoursData[d.id] || [])[w] || 0}
                          onChange={(e) => updateHours(d.id, w, e.target.value)}
                        />
                      </td>
                    ))}
                    <td style={{ ...styles.td, position: "sticky", right: 0, background: di % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, textAlign: "right", fontWeight: 700 }}>
                      {formatNumber(discTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                <td style={{ ...styles.td, fontWeight: 700, position: "sticky", left: 0, background: COLORS.surface, zIndex: 2 }}>TOTAL</td>
                {visibleWeeks.map((w) => {
                  const colTotal = disciplines.reduce((s, d) => s + ((hoursData[d.id] || [])[w] || 0), 0);
                  return <td key={w} style={{ ...styles.td, textAlign: "right", fontWeight: 600, color: colTotal > 0 ? COLORS.text : COLORS.textMuted }}>{formatNumber(colTotal)}</td>;
                })}
                <td style={{ ...styles.td, position: "sticky", right: 0, background: COLORS.surface, zIndex: 2, textAlign: "right", fontWeight: 700, color: COLORS.accent }}>
                  {formatNumber(disciplines.reduce((s, d) => s + (hoursData[d.id] || []).reduce((ss, h) => ss + h, 0), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {baseWeeks > visibleRange && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
            <button style={styles.btn()} onClick={() => setScrollStart(Math.max(0, scrollStart - visibleRange))} disabled={scrollStart === 0}>← Prev</button>
            <span style={{ color: COLORS.textDim, fontSize: 12 }}>Weeks {scrollStart + 1} – {Math.min(scrollStart + visibleRange, baseWeeks)} of {baseWeeks}</span>
            <button style={styles.btn()} onClick={() => setScrollStart(Math.min(baseWeeks - visibleRange, scrollStart + visibleRange))} disabled={scrollStart + visibleRange >= baseWeeks}>Next →</button>
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Hours Curve Preview</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={weeksArray.map((w) => {
            const pt = { week: w + 1 };
            disciplines.forEach((d) => { pt[d.name] = (hoursData[d.id] || [])[w] || 0; });
            return pt;
          })}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="week" stroke={COLORS.textMuted} tick={{ fontSize: 10 }} label={{ value: "Week", position: "insideBottom", offset: -2, fontSize: 11, fill: COLORS.textDim }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }} />
            {disciplines.map((d, i) => (
              <Area key={d.id} type="monotone" dataKey={d.name} stackId="1" stroke={DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length]} fill={DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length]} fillOpacity={0.6} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Baseline Schedule Gantt */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Baseline Schedule</div>
        <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: -8, marginBottom: 12 }}>
          Discipline spans derived from hours data. Bar intensity reflects weekly labor density.
        </div>
        {(() => {
          const labelWidth = 160;
          const rightPad = 100;
          const rowHeight = 44;
          const barHeight = 20;
          const maxWeek = baseWeeks;

          const getWeekDate = (w) => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + w * 7); snapToSunday(d);
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          };

          const tickInterval = maxWeek <= 20 ? 2 : maxWeek <= 30 ? 4 : maxWeek <= 60 ? 8 : maxWeek <= 100 ? 12 : 16;
          const ticks = [];
          for (let w = 0; w <= maxWeek; w += tickInterval) ticks.push(w);
          if (ticks[ticks.length - 1] !== maxWeek) ticks.push(maxWeek);

          // Per-discipline spans and peak hours
          const discRows = disciplines.map((d, di) => {
            const hrs = hoursData[d.id] || [];
            let first = -1, last = -1, peak = 0, total = 0;
            hrs.forEach((h, w) => {
              if (h > 0) {
                if (first < 0) first = w;
                last = w;
                if (h > peak) peak = h;
                total += h;
              }
            });
            return { name: d.name, color: DISCIPLINE_COLORS[di % DISCIPLINE_COLORS.length], first: Math.max(first, 0), last: Math.max(last, 0) + 1, peak, total, hours: hrs };
          }).filter(r => r.total > 0).sort((a, b) => a.last - b.last);

          const grandTotal = discRows.reduce((s, r) => s + r.total, 0);

          return (
            <div style={{ overflowX: "auto", position: "relative" }}>
              {/* Tooltip */}
              {baseGanttHover && (() => {
                const r = baseGanttHover.row;
                const durWeeks = r.last - r.first;
                const avgHrs = durWeeks > 0 ? Math.round(r.total / durWeeks) : 0;
                return (
                  <div style={{
                    position: "fixed", left: baseGanttHover.x + 16, top: baseGanttHover.y + 16,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: 6, padding: "10px 14px", fontSize: 11,
                    color: COLORS.text, zIndex: 100, pointerEvents: "none",
                    boxShadow: `0 4px 16px ${COLORS.bg}cc`, minWidth: 200, lineHeight: 1.7,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: r.color }}>{r.name}</div>
                    <div>Span: Wk {r.first} – {r.last - 1} <span style={{ color: COLORS.textDim }}>({durWeeks} weeks · {getWeekDate(r.first)} – {getWeekDate(r.last - 1)})</span></div>
                    <div>Total Hours: <strong>{formatNumber(r.total)}</strong></div>
                    <div>Peak Week: <strong>{formatNumber(r.peak)}</strong> hrs/wk</div>
                    <div>Average: <strong>{formatNumber(avgHrs)}</strong> hrs/wk</div>
                  </div>
                );
              })()}

              {/* Time axis */}
              <div style={{ display: "flex", marginBottom: 2 }}>
                <div style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0 }} />
                <div style={{ flex: 1, position: "relative", height: 28 }}>
                  {ticks.map((w) => (
                    <div key={w} style={{
                      position: "absolute", left: `${(w / maxWeek) * 100}%`,
                      transform: "translateX(-50%)", fontSize: 9,
                      color: COLORS.textMuted, whiteSpace: "nowrap", textAlign: "center", lineHeight: 1,
                    }}>
                      <div style={{ fontWeight: 600 }}>Wk {w}</div>
                      <div style={{ fontSize: 8, color: COLORS.textMuted + "88", marginTop: 1 }}>{getWeekDate(w)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ width: rightPad, minWidth: rightPad, flexShrink: 0 }} />
              </div>

              {/* Discipline rows */}
              {discRows.map((row, idx) => {
                const leftPct = (row.first / maxWeek) * 100;
                const widthPct = ((row.last - row.first) / maxWeek) * 100;

                return (
                  <div key={idx} style={{
                    display: "flex", alignItems: "center", height: rowHeight,
                    borderBottom: `1px solid ${COLORS.border}22`,
                    background: idx % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}33`,
                  }}>
                    {/* Label */}
                    <div style={{
                      width: labelWidth, minWidth: labelWidth, flexShrink: 0,
                      paddingLeft: 8, fontSize: 12, fontWeight: 600, color: COLORS.text,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: row.color, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                    </div>

                    {/* Bar area */}
                    <div
                      style={{ flex: 1, position: "relative", height: "100%" }}
                      onMouseEnter={(e) => setBaseGanttHover({ row, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setBaseGanttHover(prev => prev ? { ...prev, row, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setBaseGanttHover(null)}
                    >
                      {/* Grid lines */}
                      {ticks.map((w) => (
                        <div key={w} style={{
                          position: "absolute", left: `${(w / maxWeek) * 100}%`,
                          top: 0, bottom: 0, width: 1, background: `${COLORS.border}44`,
                        }} />
                      ))}

                      {/* Bar with intensity segments */}
                      <div style={{
                        position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`,
                        top: "50%", transform: "translateY(-50%)", height: barHeight,
                        borderRadius: 3, zIndex: 1, overflow: "hidden",
                        boxShadow: `0 1px 4px ${row.color}33`,
                      }}>
                        {row.peak > 0 && Array.from({ length: row.last - row.first }, (_, i) => {
                          const w = row.first + i;
                          const h = row.hours[w] || 0;
                          const intensity = h / row.peak;
                          const segWidth = 100 / (row.last - row.first);
                          return (
                            <div key={i} style={{
                              position: "absolute",
                              left: `${i * segWidth}%`, width: `${segWidth + 0.5}%`,
                              top: 0, bottom: 0,
                              background: row.color,
                              opacity: 0.15 + intensity * 0.75,
                            }} />
                          );
                        })}
                      </div>
                    </div>

                    {/* Right info */}
                    <div style={{
                      width: rightPad, minWidth: rightPad, flexShrink: 0,
                      textAlign: "right", paddingRight: 8, fontSize: 11,
                    }}>
                      <div style={{ fontWeight: 600, color: COLORS.text }}>{formatNumber(row.total)} hrs</div>
                      <div style={{ fontSize: 9, color: COLORS.textDim }}>
                        Wk {row.first}–{row.last - 1} · peak {formatNumber(row.peak)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total row */}
              <div style={{
                display: "flex", alignItems: "center", height: 36,
                borderTop: `2px solid ${COLORS.border}`, marginTop: 2,
              }}>
                <div style={{
                  width: labelWidth, minWidth: labelWidth, flexShrink: 0,
                  paddingLeft: 8, fontSize: 12, fontWeight: 700,
                  color: COLORS.accent, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  Total
                </div>
                <div style={{ flex: 1 }} />
                <div style={{
                  width: rightPad, minWidth: rightPad, flexShrink: 0,
                  textAlign: "right", paddingRight: 8,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.accent }}>{formatNumber(grandTotal)} hrs</div>
                  <div style={{ fontSize: 9, color: COLORS.textDim }}>{baseWeeks} weeks · {getWeekDate(0)} – {getWeekDate(baseWeeks)}</div>
                </div>
              </div>

              {/* Legend */}
              <div style={{ marginTop: 8, display: "flex", gap: 20, paddingLeft: labelWidth, fontSize: 10, color: COLORS.textMuted }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 24, height: 6, borderRadius: 2, background: `linear-gradient(90deg, ${COLORS.accent}22, ${COLORS.accent})` }} />
                  Bar intensity = weekly hours ÷ peak hours
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* XER Schedule Gantt with Logic Links */}
      {xerSchedule && xerSchedule.activities.length > 0 && (() => {
        const { activities, relationships } = xerSchedule;
        const totalDays = baseWeeks * 7;
        const labelW = 220;
        const rightW = 70;
        const rowH = 24;
        const barH = 14;

        // Group activities by discipline
        const groups = {};
        activities.forEach(a => {
          const g = a.discipline || 'Unassigned';
          if (!groups[g]) groups[g] = [];
          groups[g].push(a);
        });
        // Sort activities within each group by finish date
        Object.values(groups).forEach(acts => acts.sort((a, b) => a.endDay - b.endDay));

        // Sort discipline groups by their latest finish date (earliest finishing first)
        const discOrder = disciplines.map(d => d.name)
          .filter(n => groups[n]?.length > 0)
          .sort((a, b) => {
            const maxA = Math.max(...(groups[a] || []).map(x => x.endDay));
            const maxB = Math.max(...(groups[b] || []).map(x => x.endDay));
            return maxA - maxB;
          });

        // Build flat row list with group headers
        const rows = [];
        const activityRowMap = {};
        const origDiscNames = disciplines.map(d => d.name);
        discOrder.forEach((dName) => {
          const acts = groups[dName];
          if (!acts || acts.length === 0) return;
          const di = origDiscNames.indexOf(dName);
          const isCollapsed = scheduleCollapsed[dName];
          rows.push({ type: 'group', name: dName, count: acts.length, color: DISCIPLINE_COLORS[di >= 0 ? di % DISCIPLINE_COLORS.length : 0], collapsed: isCollapsed });
          if (!isCollapsed) {
            acts.forEach(a => {
              activityRowMap[a.id] = rows.length;
              rows.push({ type: 'activity', ...a, color: DISCIPLINE_COLORS[di >= 0 ? di % DISCIPLINE_COLORS.length : 0] });
            });
          }
        });
        if (groups['Unassigned']?.length > 0) {
          const isCollapsed = scheduleCollapsed['Unassigned'];
          rows.push({ type: 'group', name: 'Unassigned', count: groups['Unassigned'].length, color: '#9ca3af', collapsed: isCollapsed });
          if (!isCollapsed) {
            groups['Unassigned'].forEach(a => {
              activityRowMap[a.id] = rows.length;
              rows.push({ type: 'activity', ...a, color: '#9ca3af' });
            });
          }
        }

        const chartH = rows.length * rowH + 4;

        // Time axis
        const weekInterval = baseWeeks <= 30 ? 4 : baseWeeks <= 60 ? 8 : baseWeeks <= 100 ? 12 : 16;
        const weekTicks = [];
        for (let w = 0; w <= baseWeeks; w += weekInterval) weekTicks.push(w);
        if (weekTicks[weekTicks.length - 1] !== baseWeeks) weekTicks.push(baseWeeks);

        const getWeekDate = (w) => {
          const d = new Date(startDate);
          d.setDate(d.getDate() + w * 7); snapToSunday(d);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        };

        const dayToPct = (day) => Math.max(0, Math.min(100, (day / totalDays) * 100));

        // Build arrow data for visible rows
        const arrows = relationships.filter(r => activityRowMap[r.fromId] !== undefined && activityRowMap[r.toId] !== undefined).map(r => {
          const fromRow = activityRowMap[r.fromId];
          const toRow = activityRowMap[r.toId];
          const fromAct = activities.find(a => a.id === r.fromId);
          const toAct = activities.find(a => a.id === r.toId);
          if (!fromAct || !toAct) return null;

          let fromDay, toDay;
          const t = r.type || 'PR_FS';
          if (t === 'PR_FS' || t === 'FS') { fromDay = fromAct.endDay; toDay = toAct.startDay; }
          else if (t === 'PR_FF' || t === 'FF') { fromDay = fromAct.endDay; toDay = toAct.endDay; }
          else if (t === 'PR_SS' || t === 'SS') { fromDay = fromAct.startDay; toDay = toAct.startDay; }
          else if (t === 'PR_SF' || t === 'SF') { fromDay = fromAct.startDay; toDay = toAct.endDay; }
          else { fromDay = fromAct.endDay; toDay = toAct.startDay; }

          return { fromRow, toRow, fromPct: dayToPct(fromDay), toPct: dayToPct(toDay), isCritical: fromAct.isCritical && toAct.isCritical };
        }).filter(Boolean);

        return (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={styles.cardTitle}>XER Schedule — Activities &amp; Logic Links</div>
                <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: -8 }}>
                  {activities.length} activities · {relationships.length} logic links · Click discipline headers to expand/collapse
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ ...styles.btn("default"), fontSize: 10, padding: "4px 10px" }}
                  onClick={() => { const all = {}; discOrder.forEach(n => { all[n] = true; }); if (groups['Unassigned']) all['Unassigned'] = true; setScheduleCollapsed(all); }}>
                  Collapse All
                </button>
                <button style={{ ...styles.btn("default"), fontSize: 10, padding: "4px 10px" }}
                  onClick={() => setScheduleCollapsed({})}>
                  Expand All
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 600, position: "relative" }}>
              {/* Tooltip */}
              {scheduleHover && (() => {
                const a = scheduleHover.act;
                const durDays = Math.round(a.endDay - a.startDay);
                return (
                  <div style={{
                    position: "fixed", left: scheduleHover.x + 16, top: scheduleHover.y - 8,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: 6, padding: "10px 14px", fontSize: 11,
                    color: COLORS.text, zIndex: 200, pointerEvents: "none",
                    boxShadow: `0 4px 16px ${COLORS.bg}cc`, minWidth: 220, maxWidth: 360, lineHeight: 1.7,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: a.color }}>{a.name}</div>
                    <div>Start: {a.start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</div>
                    <div>End: {a.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</div>
                    <div>Duration: <strong>{durDays}d</strong> ({(durDays / 7).toFixed(1)} wks)</div>
                    {a.hours > 0 && <div>Hours: <strong>{formatNumber(a.hours)}</strong></div>}
                    <div>Float: <strong style={{ color: a.isCritical ? COLORS.red : COLORS.green }}>{a.totalFloat.toFixed(0)}d</strong>{a.isCritical ? ' (Critical)' : ''}</div>
                    <div style={{ color: COLORS.textMuted }}>Discipline: {a.discipline}</div>
                  </div>
                );
              })()}

              {/* Time axis header */}
              <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 10, background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ width: labelW, minWidth: labelW, flexShrink: 0, padding: "4px 8px", fontSize: 10, fontWeight: 700, color: COLORS.textDim }}>ACTIVITY</div>
                <div style={{ flex: 1, position: "relative", height: 28 }}>
                  {weekTicks.map(w => (
                    <div key={w} style={{ position: "absolute", left: `${(w / baseWeeks) * 100}%`, transform: "translateX(-50%)", fontSize: 8, color: COLORS.textMuted, whiteSpace: "nowrap", textAlign: "center", lineHeight: 1, top: 2 }}>
                      <div style={{ fontWeight: 600 }}>Wk {w}</div>
                      <div style={{ fontSize: 7, color: COLORS.textMuted + "88", marginTop: 1 }}>{getWeekDate(w)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ width: rightW, minWidth: rightW, flexShrink: 0, padding: "4px 8px", fontSize: 10, fontWeight: 700, color: COLORS.textDim, textAlign: "right" }}>DUR</div>
              </div>

              {/* Rows + SVG arrows */}
              <div style={{ position: "relative", minWidth: 700 }}>
                {/* SVG overlay for logic links */}
                <svg style={{ position: "absolute", top: 0, left: labelW, width: `calc(100% - ${labelW + rightW}px)`, height: chartH, pointerEvents: "none", zIndex: 5, overflow: "visible" }} viewBox={`0 0 1000 ${chartH}`} preserveAspectRatio="none">
                  <defs>
                    <marker id="ah" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><path d="M0,0 L6,2 L0,4 Z" fill="#9ca3af" /></marker>
                    <marker id="ahc" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><path d="M0,0 L6,2 L0,4 Z" fill="#dc2626" /></marker>
                  </defs>
                  {arrows.map((a, i) => {
                    const x1 = a.fromPct * 10;
                    const x2 = a.toPct * 10;
                    const y1 = a.fromRow * rowH + rowH / 2;
                    const y2 = a.toRow * rowH + rowH / 2;
                    const color = a.isCritical ? '#dc2626' : '#9ca3af';
                    const marker = a.isCritical ? 'url(#ahc)' : 'url(#ah)';

                    // Right-angle routing
                    if (Math.abs(y1 - y2) < 2) {
                      return <path key={i} d={`M${x1},${y1} L${x2},${y2}`} fill="none" stroke={color} strokeWidth={a.isCritical ? 1.2 : 0.7} opacity={0.55} markerEnd={marker} />;
                    }
                    const dropX = Math.min(x1 + 12, 998);
                    const enterX = Math.max(x2 - 12, 2);
                    const midY = y2 > y1 ? y1 + (y2 - y1) * 0.5 : y1 + (y2 - y1) * 0.5;
                    const path = `M${x1},${y1} L${dropX},${y1} L${dropX},${midY} L${enterX},${midY} L${enterX},${y2} L${x2},${y2}`;
                    return <path key={i} d={path} fill="none" stroke={color} strokeWidth={a.isCritical ? 1.2 : 0.7} opacity={0.55} markerEnd={marker} />;
                  })}
                </svg>

                {/* Row elements */}
                {rows.map((row, idx) => {
                  if (row.type === 'group') {
                    return (
                      <div key={`g-${row.name}-${idx}`}
                        onClick={() => setScheduleCollapsed(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                        style={{
                          display: "flex", alignItems: "center", height: rowH,
                          background: `${row.color}10`,
                          borderBottom: `1px solid ${COLORS.border}33`,
                          cursor: "pointer", userSelect: "none",
                        }}>
                        <div style={{ width: labelW, minWidth: labelW, flexShrink: 0, paddingLeft: 8, fontSize: 11, fontWeight: 700, color: row.color, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 8, display: "inline-block", transform: row.collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▼</span>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: row.color }} />
                          {row.name}
                          <span style={{ fontWeight: 400, color: COLORS.textMuted, fontSize: 10 }}>({row.count})</span>
                        </div>
                        <div style={{ flex: 1 }} />
                        <div style={{ width: rightW, minWidth: rightW, flexShrink: 0 }} />
                      </div>
                    );
                  }

                  const leftPct = dayToPct(row.startDay);
                  const widthPct = Math.max(0.3, dayToPct(row.endDay) - leftPct);
                  const isCrit = row.isCritical;

                  return (
                    <div key={`a-${row.id}-${idx}`} style={{
                      display: "flex", alignItems: "center", height: rowH,
                      borderBottom: `1px solid ${COLORS.border}11`,
                      background: idx % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22`,
                    }}>
                      <div style={{
                        width: labelW, minWidth: labelW, flexShrink: 0,
                        paddingLeft: 28, fontSize: 10, color: COLORS.text,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {isCrit && <span style={{ color: COLORS.red, fontWeight: 700, marginRight: 4, fontSize: 6 }}>●</span>}
                        {row.name}
                      </div>

                      <div style={{ flex: 1, position: "relative", height: "100%" }}
                        onMouseEnter={(e) => setScheduleHover({ act: row, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setScheduleHover(prev => prev ? { ...prev, act: row, x: e.clientX, y: e.clientY } : null)}
                        onMouseLeave={() => setScheduleHover(null)}
                      >
                        {weekTicks.map(w => (
                          <div key={w} style={{ position: "absolute", left: `${(w / baseWeeks) * 100}%`, top: 0, bottom: 0, width: 1, background: `${COLORS.border}33` }} />
                        ))}
                        <div style={{
                          position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`,
                          top: "50%", transform: "translateY(-50%)", height: barH,
                          background: isCrit ? `linear-gradient(90deg, ${COLORS.red}cc, ${COLORS.red}99)` : `linear-gradient(90deg, ${row.color}aa, ${row.color}77)`,
                          borderRadius: 2, zIndex: 2,
                          border: isCrit ? `1px solid ${COLORS.red}` : 'none',
                        }} />
                      </div>

                      <div style={{ width: rightW, minWidth: rightW, flexShrink: 0, textAlign: "right", paddingRight: 8, fontSize: 9, color: COLORS.textDim }}>
                        {Math.round(row.endDay - row.startDay)}d
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, padding: "8px 8px 4px", fontSize: 10, color: COLORS.textMuted, borderTop: `1px solid ${COLORS.border}44`, marginTop: 4, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: COLORS.red, fontWeight: 700, fontSize: 8 }}>●</span> Critical Path
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 16, height: 2, background: '#9ca3af' }} /> Logic Link
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 16, height: 2, background: '#dc2626' }} /> Critical Link
                </div>
                <span>
                  {relationships.filter(r => { const t = r.type || 'PR_FS'; return t === 'PR_FS' || t === 'FS'; }).length} FS
                  · {relationships.filter(r => { const t = r.type || ''; return t === 'PR_FF' || t === 'FF'; }).length} FF
                  · {relationships.filter(r => { const t = r.type || ''; return t === 'PR_SS' || t === 'SS'; }).length} SS
                  · {relationships.filter(r => { const t = r.type || ''; return t === 'PR_SF' || t === 'SF'; }).length} SF
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PDF Report Export — generates a print-optimized HTML report
// ═══════════════════════════════════════════════════════════════════════
function exportPDF(forecast, optimization, disciplines, timeCosts, baseWeeks, adjustedWeeks, calendarWeeks, startDate, otMode, otScope, disciplinePFs, hoursData, xerSchedule) {
  try {
  if (!forecast || !optimization) {
    alert("Export unavailable — forecast data is still loading. Please wait a moment and try again.");
    return;
  }

  const baseEndDate = new Date(startDate);
  baseEndDate.setDate(baseEndDate.getDate() + baseWeeks * 7 - 1);
  // Use CPM effective weeks for accurate end date (logic links may prevent full compression)
  const effectiveWeeks = forecast.effectiveWeeks || calendarWeeks;
  const adjEndDate = new Date(startDate);
  adjEndDate.setDate(adjEndDate.getDate() + Math.round(effectiveWeeks * 7) - 1);
  const fmtDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const fmtCur = (v) => "$" + Math.round(Math.abs(v)).toLocaleString();
  const deltaEAC = forecast.adjTotalEAC - forecast.baseTotalEAC;
  const deltaPct = forecast.baseTotalEAC > 0 ? (deltaEAC / forecast.baseTotalEAC * 100).toFixed(1) : "0.0";
  const weekOffset = adjustedWeeks - baseWeeks;
  const scenarioType = adjustedWeeks < baseWeeks ? "Accelerated" : adjustedWeeks > baseWeeks ? "Extended" : "Baseline";
  const otLabel = otMode === "none" ? "None" : otMode === "sat" ? "Saturday OT (60 hrs/wk)" : "Sat + Sun OT (70 hrs/wk)";
  const otScopeLabel = otScope === "task" ? "Task-Specific" : "Project-Wide";
  const hasOverrides = disciplinePFs && Object.keys(disciplinePFs).length > 0;


  // Discipline rows
  const discRows = (disciplines || []).map((d) => {
    const bd = forecast.weeklyDirectByDisc && forecast.weeklyDirectByDisc[d.id];
    if (!bd) return '';
    const delta = bd.adjCost - bd.baseCost;
    const hasOverride = disciplinePFs && disciplinePFs[d.id] !== undefined;
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8">${d.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right">${fmtCur(bd.baseCost)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;font-weight:600">${fmtCur(bd.adjCost)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;color:${delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#6b7280'}">
        ${delta === 0 ? "—" : (delta > 0 ? "+" : "-") + fmtCur(delta)}
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:center;font-weight:600;${hasOverride ? 'color:#7c3aed' : ''}">${(bd.compressionPF || 1).toFixed(3)}${hasOverride ? ' ★' : ''}</td>
    </tr>`;
  }).join("");


  // Time-cost rows
  const tcRows = (timeCosts || []).map((t) => {
    const weeklyRate = t.basis === "weekly" ? t.rate : t.rate / 4.33;
    const base = weeklyRate * baseWeeks;
    const adj = weeklyRate * calendarWeeks;
    const delta = adj - base;
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8">${t.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;color:#6b7280">${fmtCur(t.rate)}/${t.basis === "weekly" ? "wk" : "mo"}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right">${fmtCur(base)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;font-weight:600">${fmtCur(adj)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;color:${delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#6b7280'}">
        ${delta === 0 ? "—" : (delta > 0 ? "+" : "-") + fmtCur(delta)}
      </td>
    </tr>`;
  }).join("");


  // Waterfall rows
  const wfRows = (forecast.waterfallData || []).map((item) => {
    const color = item.type === "total" ? "#1e40af" : item.value >= 0 ? "#dc2626" : "#16a34a";
    const bg = item.type === "total" ? "#f0f4ff" : "";
    return `<tr style="background:${bg}">
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;font-weight:${item.type === 'total' ? 700 : 400}">${item.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e0e2e8;text-align:right;font-weight:${item.type === 'total' ? 700 : 600};color:${color}">
        ${item.type === "total" ? fmtCur(item.value) : (item.value >= 0 ? "+" : "-") + fmtCur(item.value)}
      </td>
    </tr>`;
  }).join("");

  // PF additional degradation rows

  const pfOverrideRows = hasOverrides ? (disciplines || []).filter(d => disciplinePFs[d.id] !== undefined).map(d => {
    const addlFactor = disciplinePFs[d.id];
    const effectivePF = (forecast.globalPF || 1) * addlFactor;
    return `<tr>
      <td style="padding:4px 12px;color:#6b7280">${d.name}</td>
      <td style="padding:4px 12px;font-weight:600;color:#7c3aed">×${addlFactor.toFixed(3)}</td>
      <td style="padding:4px 12px;color:#6b7280">Effective PF: ${effectivePF.toFixed(3)} (model ${(forecast.globalPF || 1).toFixed(3)} × ${addlFactor.toFixed(3)})</td>
    </tr>`;
  }).join("") : "";


  // Gantt summary rows (pre-sorted by finish date)
  const ganttRows = (forecast.ganttBars || []).map((bar) => {
    const colors = ["#3b82f6", "#22c55e", "#a78bfa", "#f43f5e", "#22d3ee", "#f59e0b", "#ec4899", "#84cc16"];
    const origIdx = disciplines.findIndex(d => d.id === bar.id);
    const getDate = (w) => { const d = new Date(startDate); d.setDate(d.getDate() + w * 7); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
    return `<tr>
      <td style="padding:5px 12px;border-bottom:1px solid #e0e2e8"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[origIdx >= 0 ? origIdx % colors.length : 0]};margin-right:8px;vertical-align:middle"></span>${bar.name}</td>
      <td style="padding:5px 12px;border-bottom:1px solid #e0e2e8;text-align:center;color:#6b7280">${getDate(bar.baseStart)} — ${getDate(bar.baseEnd)}</td>
      <td style="padding:5px 12px;border-bottom:1px solid #e0e2e8;text-align:center;font-weight:600">${getDate(bar.adjStart)} — ${getDate(bar.adjEnd)}</td>
      <td style="padding:5px 12px;border-bottom:1px solid #e0e2e8;text-align:right">${fmtCur(bar.adjCost)}</td>
    </tr>`;
  }).join("");


  // ── Pre-compute model appendix: SVG charts + tables ──
  const CW = 700, CH = 220, PAD = { t: 16, r: 20, b: 32, l: 50 };
  const plotW = CW - PAD.l - PAD.r, plotH = CH - PAD.t - PAD.b;

  // ── Current analysis state for chart highlights ──
  const otCap = getOtCapacity(otMode);
  const currentMinWeeks = getMinWeeks(baseWeeks, otCap, hoursData || {}, xerSchedule);
  const maxCompression = baseWeeks - currentMinWeeks;
  const currentCompression = Math.max(0, baseWeeks - adjustedWeeks);
  const currentCompressionPct = maxCompression > 0 ? Math.min(100, (currentCompression / maxCompression) * 100) : 0;
  const currentPF = forecast.globalPF || 1.0;
  const currentOtWeeks = forecast.numOtWeeks || 0;
  const currentAvgFatigue = forecast.avgMCAAFatigue || 1.0;
  const numActiveTrades = (disciplines || []).filter(d => {
    const h = hoursData && hoursData[d.id];
    return h && h.some(v => v > 0);
  }).length;
  const isCompressed = adjustedWeeks < baseWeeks;
  const isExtended = adjustedWeeks > baseWeeks;
  const HIGHLIGHT = '#e11d48'; // rose-600 for "you are here" markers
  const HIGHLIGHT_BG = 'rgba(225,29,72,0.08)';

  function svgHighlightDot(x, y, label, anchor) {
    anchor = anchor || 'start';
    return `<circle cx="${x}" cy="${y}" r="5" fill="${HIGHLIGHT}" stroke="white" stroke-width="1.5"/>` +
      `<text x="${x + (anchor === 'end' ? -8 : 8)}" y="${y + 4}" text-anchor="${anchor}" font-size="9" fill="${HIGHLIGHT}" font-weight="700">${label}</text>`;
  }
  function svgHighlightVLine(x, yTop, yBot, label) {
    return `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="${HIGHLIGHT}" stroke-width="1.5" stroke-dasharray="4 2"/>` +
      `<text x="${x}" y="${yTop - 5}" text-anchor="middle" font-size="8" fill="${HIGHLIGHT}" font-weight="700">${label}</text>`;
  }

  function svgLine(points, color, width, dash) {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} />`;
  }
  function svgAxes(xLabel, yLabel, xTicks, yTicks, yMin, yMax) {
    let s = `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${CH - PAD.b}" stroke="#d1d5db" stroke-width="1"/>`;
    s += `<line x1="${PAD.l}" y1="${CH - PAD.b}" x2="${CW - PAD.r}" y2="${CH - PAD.b}" stroke="#d1d5db" stroke-width="1"/>`;
    xTicks.forEach(([val, label]) => {
      const x = PAD.l + (val / xTicks[xTicks.length-1][0]) * plotW;
      s += `<line x1="${x}" y1="${CH - PAD.b}" x2="${x}" y2="${CH - PAD.b + 4}" stroke="#9ca3af" stroke-width="0.5"/>`;
      s += `<text x="${x}" y="${CH - PAD.b + 14}" text-anchor="middle" font-size="9" fill="#6b7280">${label}</text>`;
      s += `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${CH - PAD.b}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3 3"/>`;
    });
    yTicks.forEach(([val, label]) => {
      const y = CH - PAD.b - ((val - yMin) / (yMax - yMin)) * plotH;
      s += `<text x="${PAD.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#6b7280">${label}</text>`;
      s += `<line x1="${PAD.l}" y1="${y}" x2="${CW - PAD.r}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3 3"/>`;
    });
    s += `<text x="${PAD.l + plotW/2}" y="${CH - 2}" text-anchor="middle" font-size="10" fill="#9ca3af">${xLabel}</text>`;
    s += `<text x="12" y="${PAD.t + plotH/2}" text-anchor="middle" font-size="10" fill="#9ca3af" transform="rotate(-90, 12, ${PAD.t + plotH/2})">${yLabel}</text>`;
    return s;
  }
  function toX(val, maxVal) { return PAD.l + (val / maxVal) * plotW; }
  function toY(val, yMin, yMax) { return CH - PAD.b - ((val - yMin) / (yMax - yMin)) * plotH; }
  function svgLegend(items, y) {
    return items.map((item, i) => {
      const x = PAD.l + i * 150;
      return `<line x1="${x}" y1="${y}" x2="${x + 16}" y2="${y}" stroke="${item.color}" stroke-width="${item.width || 2}"${item.dash ? ` stroke-dasharray="${item.dash}"` : ''}/><text x="${x + 20}" y="${y + 4}" font-size="9" fill="#6b7280">${item.label}</text>`;
    }).join('');
  }


  // ── 1. PF Power Curve SVG ──
  const pfYMin = 0.82, pfYMax = 1.01;
  const pfXTicks = [0,20,40,60,80,100].map(v => [v, v + '%']);
  const pfYTicks = [[0.85, '0.85'], [0.90, '0.90'], [0.95, '0.95'], [1.00, '1.00']];
  const pfCurves = [
    { alpha: 1.0, color: '#9ca3af', width: 1.2, dash: '4 3', label: 'α=1.0 (Linear)' },
    { alpha: 1.4, color: '#60a5fa', width: 1.5, dash: '', label: 'α=1.4' },
    { alpha: PF_CURVE_ALPHA, color: '#2563eb', width: 2.5, dash: '', label: `α=${PF_CURVE_ALPHA} (Active)` },
    { alpha: 2.2, color: '#a78bfa', width: 1.5, dash: '', label: 'α=2.2' },
  ];
  let pfSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  pfSvg += svgAxes('Compression %', 'Productivity Factor', pfXTicks, pfYTicks, pfYMin, pfYMax);
  pfCurves.forEach(c => {
    const pts = [];
    for (let pct = 0; pct <= 100; pct += 2) {
      const pf = 1.0 - 0.15 * Math.pow(pct / 100, c.alpha);
      pts.push([toX(pct, 100), toY(pf, pfYMin, pfYMax)]);
    }
    pfSvg += svgLine(pts, c.color, c.width, c.dash);
  });
  // Highlight current analysis point on active curve
  if (isCompressed && currentCompressionPct > 0) {
    const hx = toX(currentCompressionPct, 100);
    const hy = toY(currentPF, pfYMin, pfYMax);
    pfSvg += svgHighlightVLine(hx, PAD.t, CH - PAD.b, `Current: ${currentCompressionPct.toFixed(0)}%`);
    pfSvg += svgHighlightDot(hx, hy, `PF = ${currentPF.toFixed(3)}`, currentCompressionPct > 70 ? 'end' : 'start');
  } else {
    pfSvg += `<text x="${PAD.l + 8}" y="${PAD.t + 14}" font-size="9" fill="#16a34a" font-weight="600">● Current: No compression (PF = 1.000)</text>`;
  }
  pfSvg += svgLegend(pfCurves.map(c => ({ color: c.color, width: c.width, dash: c.dash, label: c.label })), CH + 8);
  pfSvg += '</svg>';


  // ── 2. MCAA Fatigue SVG ──
  const mcaa60Cells = MCAA_PI[60].map(v => `<td style="padding:2px 4px;border-bottom:1px solid #e0e2e8;text-align:center;font-size:10px;color:${v < 0.8 ? '#dc2626' : v < 0.9 ? '#d97706' : '#374151'}">${v.toFixed(2)}</td>`).join("");
  const mcaa70Cells = MCAA_PI[70].map(v => `<td style="padding:2px 4px;border-bottom:1px solid #e0e2e8;text-align:center;font-size:10px;color:${v < 0.8 ? '#dc2626' : v < 0.9 ? '#d97706' : '#374151'}">${v.toFixed(2)}</td>`).join("");
  const mcaaHeaders = Array.from({length:17}, (_,i) => `<th style="text-align:center;font-size:9px">${i}</th>`).join("");
  const mcaaYMin = 0.3, mcaaYMax = 1.05;
  const mcaaXTicks = [0,4,8,12,16,20].map(v => [v, v.toString()]);
  const mcaaYTicks = [[0.4, '0.40'], [0.6, '0.60'], [0.8, '0.80'], [1.0, '1.00']];
  let mcaaSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  mcaaSvg += svgAxes('Consecutive OT Week', 'Productivity Index (PI)', mcaaXTicks, mcaaYTicks, mcaaYMin, mcaaYMax);
  // Severe threshold line
  mcaaSvg += `<line x1="${PAD.l}" y1="${toY(0.7, mcaaYMin, mcaaYMax)}" x2="${CW - PAD.r}" y2="${toY(0.7, mcaaYMin, mcaaYMax)}" stroke="#dc2626" stroke-width="0.8" stroke-dasharray="4 3"/>`;
  mcaaSvg += `<text x="${CW - PAD.r - 2}" y="${toY(0.7, mcaaYMin, mcaaYMax) - 4}" text-anchor="end" font-size="8" fill="#dc2626">Severe</text>`;
  const mcaaSeries = [
    { data: MCAA_PI[60], color: '#d97706', label: '60 hr/wk (Sat OT)', mode: 'sat' },
    { data: MCAA_PI[70], color: '#dc2626', label: '70 hr/wk (Sat+Sun OT)', mode: 'satSun' },
  ];
  mcaaSeries.forEach(s => {
    const pts = [];
    for (let w = 0; w <= 20; w++) {
      pts.push([toX(w, 20), toY(getMCAAFatigue(s.mode, w), mcaaYMin, mcaaYMax)]);
    }
    mcaaSvg += svgLine(pts, s.color, 2.2, '');
    pts.forEach(p => { mcaaSvg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${s.color}"/>`; });
  });
  // Highlight current OT fatigue range
  if (otMode !== "none" && currentOtWeeks > 0) {
    const activeSchedule = otMode === "sat" ? "sat" : "satSun";
    const lastPI = getMCAAFatigue(activeSchedule, currentOtWeeks);
    const hx = toX(currentOtWeeks, 20);
    const hy = toY(lastPI, mcaaYMin, mcaaYMax);
    // Shade the active OT region
    mcaaSvg += `<rect x="${PAD.l}" y="${PAD.t}" width="${hx - PAD.l}" height="${plotH}" fill="${HIGHLIGHT_BG}" />`;
    mcaaSvg += svgHighlightVLine(hx, PAD.t, CH - PAD.b, `${currentOtWeeks} OT wks`);
    mcaaSvg += svgHighlightDot(hx, hy, `PI = ${lastPI.toFixed(3)} (avg ${currentAvgFatigue.toFixed(3)})`, currentOtWeeks > 14 ? 'end' : 'start');
  } else {
    mcaaSvg += `<text x="${PAD.l + 8}" y="${PAD.t + 14}" font-size="9" fill="#16a34a" font-weight="600">● Current: No OT (PI = 1.000)</text>`;
  }
  mcaaSvg += svgLegend(mcaaSeries.map(s => ({ color: s.color, width: 2.2, label: s.label })), CH + 8);
  mcaaSvg += '</svg>';


  // ── 3. Trade Stacking SVG (bar chart) ──
  const stkMaxY = 28;
  const stkXTicks = [1,2,3,4,5,6,7,8].map(v => [v, v.toString()]);
  const stkYTicks = [[0, '0%'], [5, '5%'], [10, '10%'], [15, '15%'], [20, '20%'], [25, '25%']];
  let stkSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  stkSvg += svgAxes('Concurrent Trades', 'Stacking Penalty %', stkXTicks.map(([v,l]) => [v, l]), stkYTicks, 0, stkMaxY);
  // Cap line
  stkSvg += `<line x1="${PAD.l}" y1="${toY(STACKING_MAX * 100, 0, stkMaxY)}" x2="${CW - PAD.r}" y2="${toY(STACKING_MAX * 100, 0, stkMaxY)}" stroke="#dc2626" stroke-width="0.8" stroke-dasharray="4 3"/>`;
  stkSvg += `<text x="${CW - PAD.r - 2}" y="${toY(STACKING_MAX * 100, 0, stkMaxY) - 4}" text-anchor="end" font-size="8" fill="#dc2626">Cap ${STACKING_MAX * 100}%</text>`;
  const stkDensities = [
    { d: 0.8, color: '#60a5fa', label: 'Density 0.8×' },
    { d: 1.0, color: '#d97706', label: 'Density 1.0×' },
    { d: 1.5, color: '#f97316', label: 'Density 1.5×' },
    { d: 2.0, color: '#dc2626', label: 'Density 2.0×' },
  ];
  const barGroupW = plotW / 8 * 0.7;
  const barW = barGroupW / 4;
  for (let t = 1; t <= 8; t++) {
    const groupX = toX(t, 8) - barGroupW / 2;
    stkDensities.forEach((s, di) => {
      const p = t <= 1 ? 0 : Math.min(STACKING_MAX, STACKING_K * (t - 1) * Math.max(1, s.d)) * 100;
      const x = groupX + di * barW;
      const y = toY(p, 0, stkMaxY);
      const h = (CH - PAD.b) - y;
      if (h > 0) stkSvg += `<rect x="${x}" y="${y}" width="${barW - 1}" height="${h}" fill="${s.color}" opacity="0.7" rx="1"/>`;
    });
  }
  // Highlight current active trades
  if (numActiveTrades >= 1 && numActiveTrades <= 8) {
    const hx = toX(numActiveTrades, 8);
    stkSvg += `<rect x="${hx - barGroupW/2 - 3}" y="${PAD.t}" width="${barGroupW + 6}" height="${plotH}" fill="${HIGHLIGHT_BG}" rx="3"/>`;
    const currentPenalty = numActiveTrades <= 1 ? 0 : Math.min(STACKING_MAX, STACKING_K * (numActiveTrades - 1)) * 100;
    stkSvg += `<text x="${hx}" y="${PAD.t + 12}" text-anchor="middle" font-size="9" fill="${HIGHLIGHT}" font-weight="700">▼ ${numActiveTrades} trades active${currentPenalty > 0 ? ` (≥${currentPenalty.toFixed(0)}%)` : ''}</text>`;
  }
  stkSvg += svgLegend(stkDensities.map(s => ({ color: s.color, width: 8, label: s.label })), CH + 8);
  stkSvg += '</svg>';


  // ── 4. Combined Multiplier SVG ──
  const cmbYMin = 0.9, cmbYMax = 2.2;
  const cmbXTicks = [0,20,40,60,80,100].map(v => [v, v + '%']);
  const cmbYTicks = [[1.0, '1.0×'], [1.2, '1.2×'], [1.4, '1.4×'], [1.6, '1.6×'], [1.8, '1.8×'], [2.0, '2.0×']];
  const piRef = [1.00, 1.00, 0.95, 0.93, 0.91, 0.89, 0.87, 0.85, 0.83, 0.80, 0.76, 0.72, 0.70, 0.68, 0.66, 0.64, 0.63];
  let cmbSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  cmbSvg += svgAxes('Compression %', 'Cost Multiplier', cmbXTicks, cmbYTicks, cmbYMin, cmbYMax);
  cmbSvg += `<line x1="${PAD.l}" y1="${toY(1.0, cmbYMin, cmbYMax)}" x2="${CW - PAD.r}" y2="${toY(1.0, cmbYMin, cmbYMax)}" stroke="#9ca3af" stroke-width="0.8" stroke-dasharray="5 5"/>`;
  const cmbSeries = [
    { name: 'PF Multiplier', color: '#2563eb', width: 1.8, fn: frac => 1 / (1.0 - 0.15 * Math.pow(frac, PF_CURVE_ALPHA)) },
    { name: 'Fatigue Mult.', color: '#d97706', width: 1.8, fn: frac => { const w = Math.round(frac * 12); return 1 / Math.max(0.35, piRef[Math.min(w, piRef.length - 1)]); } },
    { name: 'Stacking Mult.', color: '#a78bfa', width: 1.8, fn: frac => 1 + Math.min(STACKING_MAX, STACKING_K * 3 * Math.max(1, 1 + frac)) },
    { name: 'Combined', color: '#dc2626', width: 2.8, fn: null },
  ];
  const cmbPts = {};
  cmbSeries.forEach(s => { cmbPts[s.name] = []; });
  for (let pct = 0; pct <= 100; pct += 2) {
    const frac = pct / 100;
    const pfM = cmbSeries[0].fn(frac);
    const fatM = cmbSeries[1].fn(frac);
    const stkM = cmbSeries[2].fn(frac);
    cmbPts[cmbSeries[0].name].push([toX(pct, 100), toY(Math.min(pfM, cmbYMax), cmbYMin, cmbYMax)]);
    cmbPts[cmbSeries[1].name].push([toX(pct, 100), toY(Math.min(fatM, cmbYMax), cmbYMin, cmbYMax)]);
    cmbPts[cmbSeries[2].name].push([toX(pct, 100), toY(Math.min(stkM, cmbYMax), cmbYMin, cmbYMax)]);
    cmbPts['Combined'].push([toX(pct, 100), toY(Math.min(pfM * fatM * stkM, cmbYMax), cmbYMin, cmbYMax)]);
  }
  cmbSeries.forEach(s => { cmbSvg += svgLine(cmbPts[s.name], s.color, s.width, ''); });
  // Highlight current combined multiplier
  if (isCompressed && currentCompressionPct > 0) {
    const frac = currentCompressionPct / 100;
    const curPfM = cmbSeries[0].fn(frac);
    const curFatM = cmbSeries[1].fn(frac);
    const curStkM = cmbSeries[2].fn(frac);
    const curCombined = curPfM * curFatM * curStkM;
    const hx = toX(currentCompressionPct, 100);
    const hy = toY(Math.min(curCombined, cmbYMax), cmbYMin, cmbYMax);
    cmbSvg += svgHighlightVLine(hx, PAD.t, CH - PAD.b, `Current: ${currentCompressionPct.toFixed(0)}%`);
    cmbSvg += svgHighlightDot(hx, hy, `Combined: ${curCombined.toFixed(3)}×`, currentCompressionPct > 70 ? 'end' : 'start');
  } else {
    cmbSvg += `<text x="${PAD.l + 8}" y="${PAD.t + 14}" font-size="9" fill="#16a34a" font-weight="600">● Current: No compression (multiplier = 1.000×)</text>`;
  }
  cmbSvg += svgLegend(cmbSeries.map(s => ({ color: s.color, width: s.width, label: s.name })), CH + 8);
  cmbSvg += '</svg>';


  // ── 4. OT Progressive SVG (dual-axis: bars + lines) ──
  const otData = [2,4,6,8,10,12,14].filter(c => baseWeeks - c >= 8).map(c => {
    const w = baseWeeks - c;
    return {
      compression: c, duration: w,
      satOt: Math.round(c * 40 / 10), ssOt: Math.round(c * 40 / 20),
      satUtil: Math.min(100, Math.round(Math.round(c * 40 / 10) / w * 100)),
      ssUtil: Math.min(100, Math.round(Math.round(c * 40 / 20) / w * 100)),
    };
  });
  const otMaxWeeks = Math.max(...otData.map(d => d.satOt), 1);
  const otXTicks = otData.map((d, i) => [i, `−${d.compression}`]);
  const otYTicks = Array.from({length: 5}, (_, i) => { const v = Math.round(otMaxWeeks / 4 * i); return [v, v.toString()]; });
  const otBarW2 = otData.length > 0 ? plotW / otData.length * 0.35 : 20;
  let otSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  otSvg += svgAxes('Compression (weeks)', 'OT Weeks Required', otXTicks, otYTicks, 0, otMaxWeeks);
  // Right Y axis label for utilization
  otSvg += `<text x="${CW - 8}" y="${PAD.t + plotH/2}" text-anchor="middle" font-size="10" fill="#9ca3af" transform="rotate(90, ${CW - 8}, ${PAD.t + plotH/2})">OT Utilization %</text>`;
  otData.forEach((d, i) => {
    const cx = PAD.l + ((i + 0.5) / otData.length) * plotW;
    // Bars - Sat OT
    const h1 = (d.satOt / otMaxWeeks) * plotH;
    otSvg += `<rect x="${cx - otBarW2 - 1}" y="${CH - PAD.b - h1}" width="${otBarW2}" height="${h1}" fill="#d97706" opacity="0.6" rx="2"/>`;
    // Bars - Sat+Sun OT
    const h2 = (d.ssOt / otMaxWeeks) * plotH;
    otSvg += `<rect x="${cx + 1}" y="${CH - PAD.b - h2}" width="${otBarW2}" height="${h2}" fill="#dc2626" opacity="0.5" rx="2"/>`;
    // Labels
    otSvg += `<text x="${cx - otBarW2/2 - 1}" y="${CH - PAD.b - h1 - 3}" text-anchor="middle" font-size="8" fill="#d97706">${d.satOt}</text>`;
    otSvg += `<text x="${cx + otBarW2/2 + 1}" y="${CH - PAD.b - h2 - 3}" text-anchor="middle" font-size="8" fill="#dc2626">${d.ssOt}</text>`;
  });
  // Utilization lines overlaid (mapped to full plot height = 100%)
  const satUtilPts = otData.map((d, i) => [PAD.l + ((i + 0.5) / otData.length) * plotW, CH - PAD.b - (d.satUtil / 100) * plotH]);
  const ssUtilPts = otData.map((d, i) => [PAD.l + ((i + 0.5) / otData.length) * plotW, CH - PAD.b - (d.ssUtil / 100) * plotH]);
  otSvg += svgLine(satUtilPts, '#d97706', 2, '');
  otSvg += svgLine(ssUtilPts, '#dc2626', 2, '');
  satUtilPts.forEach((p, i) => { otSvg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#d97706"/>`; });
  ssUtilPts.forEach((p, i) => { otSvg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#dc2626"/>`; });
  // Highlight current compression on OT chart
  if (isCompressed && currentCompression > 0 && otData.length > 0) {
    const closestIdx = otData.reduce((best, d, i) => Math.abs(d.compression - currentCompression) < Math.abs(otData[best].compression - currentCompression) ? i : best, 0);
    const cx = PAD.l + ((closestIdx + 0.5) / otData.length) * plotW;
    otSvg += `<rect x="${cx - otBarW2 - 5}" y="${PAD.t}" width="${otBarW2 * 2 + 10}" height="${plotH}" fill="${HIGHLIGHT_BG}" rx="3"/>`;
    otSvg += `<text x="${cx}" y="${PAD.t + 12}" text-anchor="middle" font-size="9" fill="${HIGHLIGHT}" font-weight="700">▼ Current: −${currentCompression} wks (${currentOtWeeks} OT)</text>`;
  } else if (!isCompressed) {
    otSvg += `<text x="${PAD.l + 8}" y="${PAD.t + 14}" font-size="9" fill="#16a34a" font-weight="600">● Current: No compression — no OT required</text>`;
  }
  otSvg += svgLegend([
    { color: '#d97706', width: 8, label: 'Sat OT Weeks' },
    { color: '#dc2626', width: 8, label: 'Sat+Sun OT Weeks' },
    { color: '#d97706', width: 2, label: 'Sat Util %' },
    { color: '#dc2626', width: 2, label: 'Sat+Sun Util %' },
  ], CH + 8);
  otSvg += '</svg>';


  // ── 5. Risk Band SVG (grouped bar) ──
  const riskFactors = ['PF Scale', 'Fatigue Scale', 'Stacking Scale'];
  const riskBands = [
    { label: 'P50', color: '#16a34a', values: [1.0, 1.0, 1.0] },
    { label: 'P80', color: '#d97706', values: [RISK_BANDS.P80.pfScale, RISK_BANDS.P80.fatigueScale, RISK_BANDS.P80.stackScale] },
    { label: 'P90', color: '#dc2626', values: [RISK_BANDS.P90.pfScale, RISK_BANDS.P90.fatigueScale, RISK_BANDS.P90.stackScale] },
  ];
  const riskYMax = 1.6;
  const riskYTicks2 = [[0.8, '0.8×'], [1.0, '1.0×'], [1.2, '1.2×'], [1.4, '1.4×'], [1.6, '1.6×']];
  const riskXTicks = riskFactors.map((f, i) => [i + 0.5, f]);
  let riskSvg = `<svg width="${CW}" height="${CH + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
  riskSvg += svgAxes('', 'Scale Factor', riskXTicks.map(([v, l]) => [v * (3/riskFactors.length), l]), riskYTicks2, 0.7, riskYMax);
  const riskGroupW = plotW / 3 * 0.65;
  const riskBarW = riskGroupW / 3;
  riskFactors.forEach((factor, fi) => {
    const groupCx = PAD.l + ((fi + 0.5) / 3) * plotW;
    riskBands.forEach((band, bi) => {
      const x = groupCx - riskGroupW/2 + bi * riskBarW;
      const val = band.values[fi];
      const y = toY(val, 0.7, riskYMax);
      const h = (CH - PAD.b) - y;
      if (h > 0) {
        riskSvg += `<rect x="${x}" y="${y}" width="${riskBarW - 2}" height="${h}" fill="${band.color}" opacity="0.7" rx="2"/>`;
        riskSvg += `<text x="${x + riskBarW/2 - 1}" y="${y - 4}" text-anchor="middle" font-size="8" fill="${band.color}" font-weight="600">${val.toFixed(2)}</text>`;
      }
    });
  });
  riskSvg += svgLegend(riskBands.map(b => ({ color: b.color, width: 8, label: b.label })), CH + 8);
  riskSvg += '</svg>';


  // ── Waterfall SVG (horizontal bar chart) ──
  const wfData = forecast.waterfallData || [];
  const hasWaterfall = wfData.length > 2;
  let waterfallSvg = '';
  if (hasWaterfall) {
    const WF_W = 700, WF_BAR_H = 28, WF_PAD = { l: 130, r: 80, t: 10, b: 10 };
    const WF_H = WF_PAD.t + wfData.length * WF_BAR_H + WF_PAD.b;
    const wfPlotW = WF_W - WF_PAD.l - WF_PAD.r;
    const wfMaxVal = Math.max(...wfData.map(d => d.barEnd), forecast.baseTotalEAC, forecast.adjTotalEAC);
    const wfMinVal = Math.min(0, ...wfData.map(d => d.barStart));
    const wfRange = wfMaxVal - wfMinVal;
    const wfToX = (val) => WF_PAD.l + ((val - wfMinVal) / wfRange) * wfPlotW;
    const wfZeroX = wfToX(0);

    waterfallSvg = `<svg width="${WF_W}" height="${WF_H}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
    // Zero line
    waterfallSvg += `<line x1="${wfZeroX}" y1="${WF_PAD.t}" x2="${wfZeroX}" y2="${WF_H - WF_PAD.b}" stroke="#e5e7eb" stroke-width="1"/>`;

    wfData.forEach((item, i) => {
      const y = WF_PAD.t + i * WF_BAR_H;
      const barH = WF_BAR_H - 6;
      const x1 = wfToX(item.barStart);
      const x2 = wfToX(item.barEnd);
      const barWidth = Math.max(1, Math.abs(x2 - x1));
      const barX = Math.min(x1, x2);

      let color;
      if (item.type === 'total') color = '#374151';
      else if (item.value > 0) color = '#dc2626';
      else color = '#16a34a';

      // Connector line from previous bar
      if (i > 0 && item.type !== 'total') {
        const prevEnd = wfToX(wfData[i-1].end);
        waterfallSvg += `<line x1="${prevEnd}" y1="${y - 3}" x2="${prevEnd}" y2="${y + 3}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="2 2"/>`;
      }

      waterfallSvg += `<rect x="${barX}" y="${y + 3}" width="${barWidth}" height="${barH}" fill="${color}" opacity="${item.type === 'total' ? 0.85 : 0.7}" rx="2"/>`;
      // Label left (centered with bar)
      waterfallSvg += `<text x="${WF_PAD.l - 6}" y="${y + 3 + barH/2}" text-anchor="end" dominant-baseline="central" font-size="10" fill="#374151" font-weight="${item.type === 'total' ? '700' : '400'}">${item.name}</text>`;
      // Value right (centered with bar)
      const valText = item.type === 'total' ? fmtCur(item.value) : (item.value >= 0 ? '+' : '-') + fmtCur(item.value);
      waterfallSvg += `<text x="${barX + barWidth + 5}" y="${y + 3 + barH/2}" text-anchor="start" dominant-baseline="central" font-size="10" fill="${color}" font-weight="600">${valText}</text>`;
    });
    waterfallSvg += '</svg>';
  }


  // ── Schedule Optimization Curve SVG ──
  const curveData = optimization.curve || [];
  let scheduleSvg = '';
  if (curveData.length > 2) {
    const SC_W = 700, SC_H = 260, SC_PAD = { t: 16, r: 60, b: 36, l: 70 };
    const scPlotW = SC_W - SC_PAD.l - SC_PAD.r, scPlotH = SC_H - SC_PAD.t - SC_PAD.b;

    // Find data ranges
    const allCosts = curveData.flatMap(d => [d.totalCost, d.directCost, d.timeCost, d.totalCostP80]);
    const scYMin = Math.min(...allCosts) * 0.95;
    const scYMax = Math.max(...curveData.map(d => d.totalCostP80 || d.totalCost)) * 1.03;
    const scXMin = curveData[0].weeks;
    const scXMax = curveData[curveData.length - 1].weeks;

    const scToX = (w) => SC_PAD.l + ((w - scXMin) / (scXMax - scXMin)) * scPlotW;
    const scToY = (v) => SC_H - SC_PAD.b - ((v - scYMin) / (scYMax - scYMin)) * scPlotH;

    const scFmtK = (v) => '$' + (v / 1000).toFixed(0) + 'k';
    const scFmtM = (v) => v >= 1000000 ? '$' + (v / 1000000).toFixed(1) + 'M' : scFmtK(v);

    scheduleSvg = `<svg width="${SC_W}" height="${SC_H + 20}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;

    // Grid
    const xStep = Math.max(1, Math.round((scXMax - scXMin) / 8));
    for (let w = scXMin; w <= scXMax; w += xStep) {
      const x = scToX(w);
      scheduleSvg += `<line x1="${x}" y1="${SC_PAD.t}" x2="${x}" y2="${SC_H - SC_PAD.b}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3 3"/>`;
      scheduleSvg += `<text x="${x}" y="${SC_H - SC_PAD.b + 14}" text-anchor="middle" font-size="9" fill="#6b7280">${w}</text>`;
    }
    const ySteps = 5;
    const yStep = (scYMax - scYMin) / ySteps;
    for (let i = 0; i <= ySteps; i++) {
      const v = scYMin + i * yStep;
      const y = scToY(v);
      scheduleSvg += `<line x1="${SC_PAD.l}" y1="${y}" x2="${SC_W - SC_PAD.r}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3 3"/>`;
      scheduleSvg += `<text x="${SC_PAD.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#6b7280">${scFmtM(v)}</text>`;
    }
    // Axes
    scheduleSvg += `<line x1="${SC_PAD.l}" y1="${SC_PAD.t}" x2="${SC_PAD.l}" y2="${SC_H - SC_PAD.b}" stroke="#d1d5db" stroke-width="1"/>`;
    scheduleSvg += `<line x1="${SC_PAD.l}" y1="${SC_H - SC_PAD.b}" x2="${SC_W - SC_PAD.r}" y2="${SC_H - SC_PAD.b}" stroke="#d1d5db" stroke-width="1"/>`;
    scheduleSvg += `<text x="${SC_PAD.l + scPlotW/2}" y="${SC_H - 2}" text-anchor="middle" font-size="10" fill="#9ca3af">Duration (weeks)</text>`;

    // P80 band (shaded area between P50 total and P80 total)
    let bandPath = '';
    curveData.forEach((d, i) => {
      bandPath += `${i === 0 ? 'M' : 'L'}${scToX(d.weeks).toFixed(1)},${scToY(d.totalCost).toFixed(1)}`;
    });
    for (let i = curveData.length - 1; i >= 0; i--) {
      bandPath += `L${scToX(curveData[i].weeks).toFixed(1)},${scToY(curveData[i].totalCostP80).toFixed(1)}`;
    }
    bandPath += 'Z';
    scheduleSvg += `<path d="${bandPath}" fill="#fef3c7" opacity="0.5"/>`;

    // Lines: time cost, direct cost, total, P80
    const lines = [
      { key: 'timeCost', color: '#9ca3af', width: 1.5, dash: '4 3', label: 'Time-Based Cost' },
      { key: 'directCost', color: '#60a5fa', width: 1.5, dash: '', label: 'Direct Cost' },
      { key: 'totalCost', color: '#2563eb', width: 2.5, dash: '', label: 'Total EAC (P50)' },
      { key: 'totalCostP80', color: '#d97706', width: 1.5, dash: '4 3', label: 'P80 Risk' },
    ];
    lines.forEach(line => {
      const pts = curveData.map(d => [scToX(d.weeks), scToY(d[line.key])]);
      const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      scheduleSvg += `<path d="${pathD}" fill="none" stroke="${line.color}" stroke-width="${line.width}"${line.dash ? ` stroke-dasharray="${line.dash}"` : ''}/>`;
    });

    // Markers: baseline, current, optimal
    const markers = [
      { w: baseWeeks, color: '#6b7280', label: 'Baseline', dash: '4 3' },
      { w: optimization.optimalWeeks, color: '#16a34a', label: 'Optimal', dash: '' },
    ];
    if (adjustedWeeks !== baseWeeks) {
      markers.push({ w: adjustedWeeks, color: HIGHLIGHT, label: 'Current', dash: '' });
    }
    markers.forEach(m => {
      if (m.w < scXMin || m.w > scXMax) return;
      const mx = scToX(m.w);
      scheduleSvg += `<line x1="${mx}" y1="${SC_PAD.t}" x2="${mx}" y2="${SC_H - SC_PAD.b}" stroke="${m.color}" stroke-width="1.5"${m.dash ? ` stroke-dasharray="${m.dash}"` : ''}/>`;
      scheduleSvg += `<text x="${mx}" y="${SC_PAD.t - 4}" text-anchor="middle" font-size="8" fill="${m.color}" font-weight="700">${m.label} (${m.w}w)</text>`;
      // Dot on total cost line
      const pt = curveData.find(d => d.weeks === m.w);
      if (pt) {
        const my = scToY(pt.totalCost);
        scheduleSvg += `<circle cx="${mx}" cy="${my}" r="4" fill="${m.color}" stroke="white" stroke-width="1.5"/>`;
        scheduleSvg += `<text x="${mx + (m.w > (scXMin + scXMax) / 2 ? -8 : 8)}" y="${my - 8}" text-anchor="${m.w > (scXMin + scXMax) / 2 ? 'end' : 'start'}" font-size="9" fill="${m.color}" font-weight="600">${scFmtM(pt.totalCost)}</text>`;
      }
    });

    // Legend
    const legendY = SC_H + 8;
    const allItems = [...lines, { color: '#16a34a', width: 2, label: 'Optimal' }, { color: HIGHLIGHT, width: 2, label: 'Current' }];
    scheduleSvg += allItems.map((item, i) => {
      const x = SC_PAD.l + (i % 6) * 115;
      return `<line x1="${x}" y1="${legendY}" x2="${x + 14}" y2="${legendY}" stroke="${item.color}" stroke-width="${item.width || 2}"${item.dash ? ` stroke-dasharray="${item.dash}"` : ''}/><text x="${x + 18}" y="${legendY + 4}" font-size="8" fill="#6b7280">${item.label}</text>`;
    }).join('');
    scheduleSvg += '</svg>';
  }


  // ── Gantt Schedule SVG ──
  const ganttBars = forecast.ganttBars || [];
  let ganttSvg = '';
  if (ganttBars.length > 0) {
    const G_W = 700, G_ROW_H = 36, G_LABEL_W = 140, G_RIGHT_W = 80, G_TOP = 30;
    const tcRow = { name: "Time-Based Costs", baseStart: 0, baseEnd: baseWeeks, adjStart: 0, adjEnd: adjustedWeeks, adjCost: forecast.adjTimeCost, baseCost: forecast.baseTimeCost, isTime: true };
    const allGanttRows = [...ganttBars, tcRow];
    const totalRowY = G_TOP + allGanttRows.length * G_ROW_H + 6;
    const G_H = totalRowY + G_ROW_H + 4;
    const maxWeek = Math.max(baseWeeks, adjustedWeeks, ...ganttBars.map(b => Math.max(b.baseEnd + 1, b.adjEnd + 1)));
    const barAreaW = G_W - G_LABEL_W - G_RIGHT_W;
    const barToX = (w) => G_LABEL_W + (w / maxWeek) * barAreaW;
    const otStartWeek = forecast.otStartWeek;

    const getWeekDate = (w) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + w * 7);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    // SVG defs for hatch patterns
    ganttSvg = `<svg width="${G_W}" height="${G_H}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,'Segoe UI',sans-serif">`;
    ganttSvg += `<defs>`;
    ganttSvg += `<pattern id="otHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="4" height="8" fill="rgba(0,0,0,0.35)"/></pattern>`;
    ganttSvg += `<pattern id="compressHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="4" height="8" fill="rgba(34,197,94,0.15)"/></pattern>`;
    ganttSvg += `<pattern id="extendHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="4" height="8" fill="rgba(220,38,38,0.15)"/></pattern>`;
    ganttSvg += `</defs>`;

    // Time axis (top)
    const tickInterval = maxWeek <= 30 ? 4 : maxWeek <= 60 ? 8 : maxWeek <= 100 ? 12 : 16;
    for (let w = 0; w <= maxWeek; w += tickInterval) {
      const x = barToX(w);
      ganttSvg += `<line x1="${x}" y1="${G_TOP}" x2="${x}" y2="${totalRowY}" stroke="#e5e7eb" stroke-width="0.5"/>`;
      ganttSvg += `<text x="${x}" y="12" text-anchor="middle" font-size="8" fill="#9ca3af">Wk ${w}</text>`;
      ganttSvg += `<text x="${x}" y="22" text-anchor="middle" font-size="7" fill="#c4c8cf">${getWeekDate(w)}</text>`;
    }

    allGanttRows.forEach((row, idx) => {
      const y = G_TOP + idx * G_ROW_H;
      const origIdx = row.isTime ? -1 : disciplines.findIndex(d => d.id === row.id);
      const color = row.isTime ? '#d97706' : DISCIPLINE_COLORS[origIdx >= 0 ? origIdx % DISCIPLINE_COLORS.length : 0];
      const barH = 14;
      const barY = y + (G_ROW_H - barH) / 2;

      const adjS = row.isTime ? row.adjStart : row.adjStart;
      const adjE = row.isTime ? row.adjEnd : row.adjEnd + 1;
      const baseS = row.isTime ? row.baseStart : row.baseStart;
      const baseE = row.isTime ? row.baseEnd : row.baseEnd + 1;

      // Row stripe
      if (idx % 2 === 1) ganttSvg += `<rect x="0" y="${y}" width="${G_W}" height="${G_ROW_H}" fill="#f9fafb"/>`;

      // Label
      ganttSvg += `<rect x="4" y="${barY + 2}" width="10" height="10" rx="2" fill="${color}"/>`;
      ganttSvg += `<text x="18" y="${barY + barH/2 + 4}" font-size="11" fill="#374151" font-weight="600">${row.name}</text>`;

      // Base end dashed marker
      if (adjustedWeeks !== baseWeeks) {
        const bex = barToX(baseE);
        ganttSvg += `<line x1="${bex}" y1="${y + 4}" x2="${bex}" y2="${y + G_ROW_H - 4}" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      }

      // Main adjusted bar
      const ax1 = barToX(adjS), ax2 = barToX(adjE);
      ganttSvg += `<rect x="${ax1}" y="${barY}" width="${Math.max(1, ax2 - ax1)}" height="${barH}" rx="3" fill="${color}" opacity="0.75"/>`;

      // OT hatch overlay
      if (!row.isTime && otStartWeek >= 0 && otStartWeek < adjE) {
        const otClipStart = Math.max(otStartWeek, adjS);
        const ox1 = barToX(otClipStart), ox2 = barToX(adjE);
        if (ox2 > ox1) {
          ganttSvg += `<rect x="${ox1}" y="${barY}" width="${ox2 - ox1}" height="${barH}" rx="3" fill="url(#otHatch)"/>`;
        }
      }

      // Compression/extension zone
      if (adjustedWeeks !== baseWeeks) {
        const extStart = Math.min(baseE, adjE), extEnd = Math.max(baseE, adjE);
        const ex1 = barToX(extStart), ex2 = barToX(extEnd);
        if (ex2 > ex1 + 1) {
          const isExt = adjE > baseE;
          ganttSvg += `<rect x="${ex1}" y="${barY}" width="${ex2 - ex1}" height="${barH}" rx="3" fill="url(#${isExt ? 'extendHatch' : 'compressHatch'})" stroke="${isExt ? '#dc2626' : '#16a34a'}" stroke-width="0.8" stroke-dasharray="3 3"/>`;
        }
      }

      // Right cost label
      const costDelta = row.adjCost - row.baseCost;
      const costColor = costDelta > 0 ? '#dc2626' : costDelta < 0 ? '#16a34a' : '#6b7280';
      ganttSvg += `<text x="${G_W - 6}" y="${barY + barH/2 + 1}" text-anchor="end" font-size="11" fill="#1a1d27" font-weight="600">${fmtCur(row.adjCost)}</text>`;
      if (Math.abs(costDelta) > 0.5) {
        ganttSvg += `<text x="${G_W - 6}" y="${barY + barH/2 + 12}" text-anchor="end" font-size="9" fill="${costColor}" font-weight="600">${costDelta > 0 ? '+' : '-'}${fmtCur(costDelta)}</text>`;
      }
    });

    // Total EAC row
    ganttSvg += `<line x1="0" y1="${totalRowY}" x2="${G_W}" y2="${totalRowY}" stroke="#d1d5db" stroke-width="1.5"/>`;
    ganttSvg += `<text x="4" y="${totalRowY + 22}" font-size="11" fill="#2563eb" font-weight="700" text-transform="uppercase" letter-spacing="0.5">TOTAL EAC</text>`;
    ganttSvg += `<text x="${G_W - 6}" y="${totalRowY + 18}" text-anchor="end" font-size="13" fill="#dc2626" font-weight="700">${fmtCur(forecast.adjTotalEAC)}</text>`;
    const totalDelta = forecast.adjTotalEAC - forecast.baseTotalEAC;
    if (Math.abs(totalDelta) > 0.5) {
      ganttSvg += `<text x="${G_W - 6}" y="${totalRowY + 31}" text-anchor="end" font-size="10" fill="${totalDelta > 0 ? '#dc2626' : '#16a34a'}" font-weight="600">${totalDelta > 0 ? '+' : '-'}${fmtCur(totalDelta)}</text>`;
    }

    // Legend
    const legY = totalRowY + G_ROW_H - 4;
    ganttSvg += `<line x1="${G_LABEL_W}" y1="${legY}" x2="${G_LABEL_W + 16}" y2="${legY}" stroke="#3b82f6" stroke-width="3"/>`;
    ganttSvg += `<text x="${G_LABEL_W + 20}" y="${legY + 3}" font-size="8" fill="#6b7280">Adjusted Duration</text>`;
    ganttSvg += `<line x1="${G_LABEL_W + 130}" y1="${legY}" x2="${G_LABEL_W + 146}" y2="${legY}" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    ganttSvg += `<text x="${G_LABEL_W + 150}" y="${legY + 3}" font-size="8" fill="#6b7280">Base End</text>`;
    if (adjustedWeeks < baseWeeks) {
      ganttSvg += `<rect x="${G_LABEL_W + 200}" y="${legY - 4}" width="16" height="8" fill="url(#compressHatch)" stroke="#16a34a" stroke-width="0.5" rx="1"/>`;
      ganttSvg += `<text x="${G_LABEL_W + 220}" y="${legY + 3}" font-size="8" fill="#6b7280">Compression</text>`;
    }
    if (otStartWeek >= 0) {
      ganttSvg += `<rect x="${G_LABEL_W + 300}" y="${legY - 4}" width="16" height="8" fill="url(#otHatch)" rx="1"/>`;
      ganttSvg += `<text x="${G_LABEL_W + 320}" y="${legY + 3}" font-size="8" fill="#6b7280">OT Weeks (${forecast.numOtWeeks})</text>`;
    }
    ganttSvg += '</svg>';
  }



  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>CRUNCH — EAC Forecast Report</title>
<style>
  @page { margin: 0.6in 0.7in; size: letter; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1a1d27; line-height: 1.45; max-width: 780px; margin: 0 auto; padding: 32px 20px; font-size: 13px; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 2px; color: #1a1d27; letter-spacing: -0.3px; }
  h2 { font-size: 14px; font-weight: 700; color: #374151; margin: 24px 0 8px; border-bottom: 2px solid #e5e7eb; padding-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  .metrics { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .m { flex: 1; min-width: 130px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center; }
  .m .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 3px; }
  .m .v { font-size: 18px; font-weight: 700; }
  .m .d { font-size: 11px; margin-top: 2px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  th { padding: 6px 12px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; }
  .params { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 12px; }
  .params td { padding: 4px 12px; font-size: 12px; }
  .params td:first-child { color: #6b7280; }
  .params td:last-child { font-weight: 600; }
  .note { font-size: 11px; color: #6b7280; line-height: 1.5; margin: 12px 0; padding: 10px 14px; background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 0 4px 4px 0; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
  .page-break { page-break-before: always; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>

<h1><span style="color:#d97706;font-size:28px">⟪</span> CRUNCH <span style="font-size:16px;font-weight:400;color:#6b7280">— EAC Forecast Report</span></h1>
<div class="sub">
  Report Date: ${fmtDate(new Date())} &nbsp;·&nbsp; Project Start: ${startDate} &nbsp;·&nbsp; Scenario: ${scenarioType}
  ${otMode !== "none" ? ` &nbsp;·&nbsp; ${otLabel} (${otScopeLabel})` : ''}
</div>

<div class="metrics">
  <div class="m">
    <div class="l">Original Budget</div>
    <div class="v">${fmtCur(forecast.baseTotalEAC)}</div>
    <div class="d">${baseWeeks} weeks · ${fmtDate(baseEndDate)}</div>
  </div>
  <div class="m" style="border-color:#d97706">
    <div class="l">Forecast EAC</div>
    <div class="v" style="color:#d97706">${fmtCur(forecast.adjTotalEAC)}</div>
    <div class="d" style="color:${deltaEAC >= 0 ? '#dc2626' : '#16a34a'}">${deltaEAC >= 0 ? "+" : "-"}${fmtCur(deltaEAC)} (${deltaEAC >= 0 ? "+" : ""}${deltaPct}%)</div>
  </div>
  <div class="m">
    <div class="l">Adjusted End Date</div>
    <div class="v">${fmtDate(adjEndDate)}</div>
    <div class="d">${Math.round(calendarWeeks)} wks ${weekOffset === 0 ? '(baseline)' : weekOffset < 0 ? `(${Math.abs(weekOffset)} wks compressed)` : `(+${weekOffset} wks extended)`}</div>
  </div>
  <div class="m" style="border-color:#16a34a">
    <div class="l">Optimal EAC</div>
    <div class="v" style="color:#16a34a">${fmtCur(optimization.optimalCost)}</div>
    <div class="d">${optimization.optimalWeeks} wks · ${optimization.optimalEndDate}</div>
  </div>
</div>

${hasWaterfall ? `
<h2>EAC Variance Waterfall</h2>
${waterfallSvg}
` : ''}

${scheduleSvg ? `
<h2>Schedule Optimization — Direct &amp; Time-Based Costs</h2>
<div style="font-size:11px;color:#6b7280;margin-bottom:8px">Total EAC across all feasible durations. Yellow band = P50–P80 risk range. Vertical markers show baseline, current scenario, and cost-optimal duration.</div>
${scheduleSvg}
` : ''}

${ganttSvg ? `
<h2>Schedule — Discipline &amp; Time-Based Costs</h2>
${ganttSvg}
` : ''}

${forecast.waterfallData && forecast.waterfallData.length > 2 ? `
<h2>Variance Decomposition (Detail)</h2>
<table>${wfRows}</table>
` : ''}

<h2>Direct Cost by Discipline</h2>
<table>
  <thead><tr><th>Discipline</th><th style="text-align:right">Base Cost</th><th style="text-align:right">Adjusted</th><th style="text-align:right">Variance</th><th style="text-align:center">PF</th></tr></thead>
  <tbody>${discRows}</tbody>
  <tfoot><tr style="border-top:2px solid #d1d5db">
    <td style="padding:6px 12px;font-weight:700">Total Direct</td>
    <td style="padding:6px 12px;text-align:right;font-weight:700">${fmtCur(forecast.totalBaseDirectCost)}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:700">${fmtCur(forecast.totalAdjDirectCost)}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:700;color:${forecast.totalAdjDirectCost >= forecast.totalBaseDirectCost ? '#dc2626' : '#16a34a'}">${forecast.totalAdjDirectCost === forecast.totalBaseDirectCost ? '—' : (forecast.totalAdjDirectCost > forecast.totalBaseDirectCost ? '+' : '-') + fmtCur(forecast.totalAdjDirectCost - forecast.totalBaseDirectCost)}</td>
    <td></td>
  </tr></tfoot>
</table>

<h2>Time-Based Cost Breakdown</h2>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Rate</th><th style="text-align:right">Base Cost</th><th style="text-align:right">Adjusted</th><th style="text-align:right">Variance</th></tr></thead>
  <tbody>${tcRows}</tbody>
  <tfoot><tr style="border-top:2px solid #d1d5db">
    <td style="padding:6px 12px;font-weight:700">Total Time-Based</td><td></td>
    <td style="padding:6px 12px;text-align:right;font-weight:700">${fmtCur(forecast.baseTimeCost)}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:700">${fmtCur(forecast.adjTimeCost)}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:700;color:${forecast.adjTimeCost > forecast.baseTimeCost ? '#dc2626' : forecast.adjTimeCost < forecast.baseTimeCost ? '#16a34a' : '#6b7280'}">${forecast.adjTimeCost === forecast.baseTimeCost ? '—' : (forecast.adjTimeCost > forecast.baseTimeCost ? '+' : '-') + fmtCur(forecast.adjTimeCost - forecast.baseTimeCost)}</td>
  </tr></tfoot>
</table>

<div class="note">
  <strong>Time-Based Burn Rate:</strong> ${fmtCur(forecast.weeklyTimeCostRate)}/week (${fmtCur(forecast.weeklyTimeCostRate * 4.33)}/month).
  Each week of schedule extension adds ${fmtCur(forecast.weeklyTimeCostRate)} in time-based costs.
</div>

<h2>Schedule Summary</h2>
<table>
  <thead><tr><th>Discipline</th><th style="text-align:center">Baseline Span</th><th style="text-align:center">Adjusted Span</th><th style="text-align:right">Adjusted Cost</th></tr></thead>
  <tbody>${ganttRows}
    <tr style="border-top:2px solid #d1d5db">
      <td style="padding:5px 12px;font-weight:600;color:#d97706">Time-Based Costs</td>
      <td style="padding:5px 12px;text-align:center;color:#6b7280">Wk 1 — ${baseWeeks}</td>
      <td style="padding:5px 12px;text-align:center;font-weight:600">Wk 1 — ${adjustedWeeks}</td>
      <td style="padding:5px 12px;text-align:right;font-weight:600">${fmtCur(forecast.adjTimeCost)}</td>
    </tr>
  </tbody>
</table>

<h2>Model Parameters &amp; Assumptions</h2>
<table class="params">
  <tr><td>Schedule Scenario</td><td>${scenarioType} (${weekOffset === 0 ? 'no change' : (weekOffset > 0 ? '+' : '') + weekOffset + ' weeks'})</td></tr>
  <tr><td>Overtime Mode</td><td>${otLabel}${otMode !== "none" ? ` — ${otScopeLabel}` : ''}</td></tr>
  ${forecast.numOtWeeks > 0 ? `<tr><td>OT Weeks Applied</td><td>${forecast.numOtWeeks} weeks (avg MCAA fatigue PI: ${(forecast.avgMCAAFatigue || 1).toFixed(3)})</td></tr>` : ''}
  <tr><td>Acceleration PF (BRT)</td><td>${ACCEL_PF.toFixed(2)} (fixed — BRT/MCAA empirical${adjustedWeeks < baseWeeks ? ', effective: ' + (forecast.globalPF || 1).toFixed(3) : ''})</td></tr>
  <tr><td>Extension PF</td><td>${EXTENSION_PF.toFixed(2)} (fixed — no gain per BRT data)</td></tr>
  <tr><td>PF Model</td><td>Non-linear power curve (BRT/MCAA, α=${PF_CURVE_ALPHA})</td></tr>
  <tr><td>Trade Stacking</td><td>MCAA Factor Model — incremental only (${STACKING_K * 100}%/trade beyond baseline stacking, capped at ${STACKING_MAX * 100}%)</td></tr>
  <tr><td>Risk Bands</td><td>P80: ${fmtCur(optimization.currentP80)} · P90: ${fmtCur(optimization.currentP90)}</td></tr>
  <tr><td>Optimal Duration</td><td>${optimization.optimalWeeks} weeks (${optimization.optimalEndDate}) — saves ${fmtCur(optimization.savingsVsCurrent)} vs current</td></tr>
  <tr><td>Time-Based Burn Rate</td><td>${fmtCur(forecast.weeklyTimeCostRate)}/week</td></tr>
</table>

${hasOverrides ? `
<h2>Discipline PF Adjustments</h2>
<div class="note">The following disciplines have additional productivity degradation applied beyond the model PF of ${(forecast.globalPF || 1).toFixed(3)}. Adjusted values are marked with ★ in the discipline table.</div>
<table class="params">${pfOverrideRows}</table>
` : ''}

<div class="page-break"></div>
<h1 style="font-size:16px;margin-bottom:2px">Appendix: CRUNCH Forecast Models &amp; Parameters</h1>
<div class="sub">Mathematical models, empirical data, and parametric assumptions used in this CRUNCH forecast</div>

<h2>1. Non-Linear Productivity Factor (Power Curve)</h2>
<div class="note">
<strong>Formula:</strong> PF(c) = 1.0 + (ACCEL_PF &minus; 1.0) &times; c<sup>&alpha;</sup><br>
where c = compression fraction = (baseWeeks &minus; targetWeeks) / (baseWeeks &minus; minWeeks)<br>
<strong>&alpha; = ${PF_CURVE_ALPHA}</strong> (power exponent, fitted to BRT/MCAA averaged data, R&sup2; &asymp; 0.94)<br>
<strong>ACCEL_PF = ${ACCEL_PF}</strong> (max PF at full compression &mdash; BRT empirical 15% loss)<br>
<strong>EXTENSION_PF = ${EXTENSION_PF}</strong> (no gain from extension per BRT data)
</div>
${pfSvg}
<div style="font-size:10px;color:#9ca3af;margin-top:4px">Sources: BRT "More Construction for the Money" (1983); Thomas, Horner "Productivity Modeling" (1997); MCAA Bulletin OT1 Rev. (2011)</div>

<h2>2. MCAA Cumulative Overtime Fatigue</h2>
<div class="note">
<strong>Formula:</strong> Cost Multiplier = 1 / PI(otMode, consecutiveWeek)<br>
PI sourced from MCAA Bulletin OT1 lookup tables (averaged from BRT, NECA, Thomas, US Army COE).<br>
Beyond table range: linear extrapolation with floor of <strong>0.35</strong>.
</div>
${mcaaSvg}
<table style="font-size:10px;margin-top:8px">
  <thead><tr><th style="font-size:9px">Schedule</th>${mcaaHeaders}</tr></thead>
  <tbody>
    <tr><td style="padding:2px 4px;border-bottom:1px solid #e0e2e8;font-weight:600;white-space:nowrap;font-size:10px">60 hr/wk</td>${mcaa60Cells}</tr>
    <tr><td style="padding:2px 4px;border-bottom:1px solid #e0e2e8;font-weight:600;white-space:nowrap;font-size:10px">70 hr/wk</td>${mcaa70Cells}</tr>
  </tbody>
</table>
<div style="font-size:10px;color:#9ca3af;margin-top:4px">Sources: Hanna, Sullivan, Lackney (2004); Hanna, Taylor, Sullivan (2005) ASCE JCEM; BRT (1980); NECA (1989); Thomas/Penn State (1997); US Army COE (1979)</div>

<h2>3. Trade Stacking / Congestion Penalty</h2>
<div class="note">
<strong>Formula:</strong> Raw(w) = min(${STACKING_MAX * 100}%, K &times; (activeTrades &minus; 1) &times; max(1, density))<br>
<strong>Net Penalty(w) = max(0, Raw(w) &minus; baselineAvgPenalty)</strong> &mdash; only incremental stacking beyond the base plan is applied.<br>
<strong>K = ${STACKING_K}</strong> (${STACKING_K * 100}% per additional concurrent trade) &nbsp;|&nbsp; <strong>Cap = ${STACKING_MAX * 100}%</strong>
</div>
${stkSvg}
<div style="font-size:10px;color:#9ca3af;margin-top:4px">Source: Hanna, Taylor, Sullivan (2007) "Impact of Overmanning" ASCE JCEM</div>

<h2>4. Progressive Overtime Allocation</h2>
<div class="note">
<strong>Formula:</strong> OT Weeks = round((baseWeeks &minus; targetWeeks) &times; 50 / otHoursPerDay)<br>
<strong>Sat OT:</strong> 60 hr/wk (factor 1.20) &nbsp;|&nbsp; <strong>Sat+Sun OT:</strong> 70 hr/wk (factor 1.40)<br>
<strong>Blended Rate</strong> = (50 &times; baseRate + otHrs &times; otRate) / totalHrsPerWeek
</div>
${otSvg}
<div style="font-size:10px;color:#9ca3af;margin-top:4px">OT weeks applied progressively from end of schedule backward. Base schedule: ${baseWeeks} weeks.</div>

<h2>5. Risk Band Sensitivity (AACE 42R-08)</h2>
<div class="note">
Probabilistic cost ranges via penalty amplification.<br>
<strong>Scaled PF Loss</strong> = (1 &minus; basePF) &times; pfScale &nbsp;|&nbsp; <strong>Scaled Fatigue</strong> = 1 &minus; (1 &minus; PI) &times; fatigueScale &nbsp;|&nbsp; <strong>Scaled Stacking</strong> = penalty &times; stackScale
</div>
${riskSvg}
<table style="margin-top:8px">
  <thead><tr><th>Band</th><th style="text-align:center">PF Scale</th><th style="text-align:center">Fatigue Scale</th><th style="text-align:center">Stacking Scale</th></tr></thead>
  <tbody>
    <tr><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;font-weight:600;color:#16a34a">P50 (Expected)</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;1.00</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;1.00</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;1.00</td></tr>
    <tr><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;font-weight:600;color:#d97706">P80 (Pessimistic)</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P80.pfScale.toFixed(2)}</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P80.fatigueScale.toFixed(2)}</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P80.stackScale.toFixed(2)}</td></tr>
    <tr><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;font-weight:600;color:#dc2626">P90 (Very Pessimistic)</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P90.pfScale.toFixed(2)}</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P90.fatigueScale.toFixed(2)}</td><td style="padding:4px 12px;border-bottom:1px solid #e0e2e8;text-align:center">&times;${RISK_BANDS.P90.stackScale.toFixed(2)}</td></tr>
  </tbody>
</table>
<div style="font-size:10px;color:#9ca3af;margin-top:4px">Source: AACE International RP 42R-08 "Risk Analysis and Contingency Determination" (2011)</div>

<h2>6. Combined Cost Multiplier Cascade</h2>
<div class="note">
<strong>Formula:</strong> WeekCost(w) = hours(w) &times; rate(w) &times; (1/PF) &times; (1/PI) &times; (1 + stackPenalty)<br>
All multipliers &ge; 1.0; compound effect produces exponentially escalating costs at severe compression.
</div>
${cmbSvg}

<div class="footer">
  <span>CRUNCH — Cost Risk Under Networked Compression Heuristics</span>
  <span>${fmtDate(new Date())} &middot; ${scenarioType} scenario (${Math.round(calendarWeeks)} weeks)</span>
</div>

<div class="no-print" style="text-align:center;margin-top:24px">
  <button onclick="window.print()" style="padding:10px 28px;font-size:14px;font-weight:600;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer">
    Print / Save as PDF
  </button>
</div>
</body></html>`;


  // Use iframe with srcdoc — avoids cross-origin blob issues and popup blockers
  let iframe = document.getElementById("__pdf_print_frame");
  if (iframe) iframe.remove();
  iframe = document.createElement("iframe");
  iframe.id = "__pdf_print_frame";
  iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:800px;height:600px;border:none;";
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      // Fallback: open in new tab for manual print
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    }
    // After print dialog closes (or immediately if print failed), remove iframe
    // Use a longer timeout so the user can interact with the print dialog
    setTimeout(() => {
      if (document.getElementById("__pdf_print_frame")) {
        document.getElementById("__pdf_print_frame").remove();
      }
    }, 1000);
  };
  } catch (err) {
    console.error("[CRUNCH Export] exportPDF error:", err);
    alert("Export failed: " + err.message);
  }
}

function ForecastTab({ disciplines, hoursData, timeCosts, baseWeeks, startDate, weekOffset, setWeekOffset, otMode, otScope, disciplinePFs, exportRef, pendingExport, xerSchedule }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);
  const [showByDiscipline, setShowByDiscipline] = useState(false);
  const [showCostCurve, setShowCostCurve] = useState(false);
  const [ganttTooltip, setGanttTooltip] = useState(null);
  const [showTaskSchedule, setShowTaskSchedule] = useState(true);
  const [taskGanttTooltip, setTaskGanttTooltip] = useState(null);
  const [taskGanttCollapsed, setTaskGanttCollapsed] = useState({});

  const otCap = getOtCapacity(otMode);
  const adjustedWeeks = baseWeeks + weekOffset;
  const calendarWeeks = adjustedWeeks;
  const minWeeks = getMinWeeks(baseWeeks, otCap, hoursData, xerSchedule);
  const noOtMaxWeeks = Math.round(baseWeeks * 1.5);
  const maxWeeks = otMode !== "none" ? baseWeeks : noOtMaxWeeks;
  const maxCompression = baseWeeks - minWeeks;
  const maxExtension = maxWeeks - baseWeeks;

  const baseEndDate = new Date(startDate);
  baseEndDate.setDate(baseEndDate.getDate() + baseWeeks * 7 - 1); snapToSunday(baseEndDate);

  const forecast = useMemo(() => {
    const weeklyDirectByDisc = {};
    let totalBaseDirectCost = 0;
    let totalAdjDirectCost = 0;

    // ── CPM task-level compression ──
    // When XER schedule is available, compress individual task durations
    // and run CPM forward pass to determine actual weekly hours per discipline.
    let cpmResult = null;
    if (xerSchedule && xerSchedule.activities && xerSchedule.activities.length > 0) {
      cpmResult = compressByCPM(xerSchedule, adjustedWeeks, baseWeeks, otMode);
    }
    // Only use CPM-derived hours for cost calculation when actually compressing/extending
    const useCpmHours = cpmResult && adjustedWeeks !== baseWeeks;
    const cpmForHours = useCpmHours ? cpmResult : null;
    // Effective duration: CPM may yield slightly different weeks due to logic links
    const effectiveWeeks = useCpmHours ? cpmResult.achievedWeeks : adjustedWeeks;

    // Per-discipline PF: when CPM is available, each discipline gets its own PF
    // based on how much its tasks were actually compressed. Non-critical disciplines
    // (with float, never compressed) get PF=1.0. Without CPM, falls back to uniform global PF.
    const perDiscPFMap = (useCpmHours && cpmResult.discCompression && effectiveWeeks < baseWeeks)
      ? getPerDisciplinePF(cpmResult.discCompression)
      : {};
    const hasPerDiscPF = Object.keys(perDiscPFMap).length > 0;

    // Uniform fallback PF for non-CPM mode or extension
    let uniformPF = 1.0;
    if (effectiveWeeks < baseWeeks) {
      uniformPF = getNonLinearPF(effectiveWeeks, baseWeeks, otCap, hoursData);
    } else if (effectiveWeeks > baseWeeks && maxExtension > 0) {
      const extensionFrac = (effectiveWeeks - baseWeeks) / maxExtension;
      uniformPF = 1.0 + (EXTENSION_PF - 1.0) * extensionFrac;
    }

    // Get PF for a specific discipline: per-disc CPM PF > uniform fallback > extension PF
    // Then multiply by any additional user-specified degradation factor
    const getDiscPF = (discId) => {
      const basePF = hasPerDiscPF ? (perDiscPFMap[discId] || 1.0) : uniformPF;
      const addlFactor = disciplinePFs[discId];
      if (addlFactor !== undefined && addlFactor !== null) return basePF * addlFactor;
      return basePF;
    };

    // Compute trade stacking penalties per week (uses CPM hours when available)
    const cpmAdjustedByDisc = cpmForHours ? cpmForHours.hoursData : null;
    const stackingPenalties = computeStackingPenalties(hoursData, baseWeeks, effectiveWeeks, cpmAdjustedByDisc);

    let totalStackingImpact = 0;
    let avgMCAAFatigue = 1.0;
    const numOtWeeks = getOtWeeks(effectiveWeeks, baseWeeks, otMode);

    // Waterfall decomposition accumulators
    let wf_redistributedCost = 0;  // hours redistributed, base rate, PF=1, no OT/fatigue/stacking
    let wf_costWithPF = 0;         // + PF applied (per discipline)
    let wf_costWithPFandOT = 0;    // + OT rates (no fatigue/stacking)

    disciplines.forEach((d) => {
      const origHours = hoursData[d.id] || new Array(baseWeeks).fill(0);
      const totalHrs = origHours.reduce((s, h) => s + h, 0);
      const baseCost = totalHrs * d.rate;
      const discPF = getDiscPF(d.id);

      // Determine if this discipline's tasks were actually compressed
      // In "task" scope mode, only compressed disciplines get OT rates/fatigue
      const discIsCompressed = hasPerDiscPF
        ? (perDiscPFMap[d.id] !== undefined && perDiscPFMap[d.id] < 1.0)
        : (effectiveWeeks < baseWeeks);
      const discApplyOt = otScope === "zone" || discIsCompressed;

      // Use CPM-derived hours when available, else proportional redistribution
      const adjHours = cpmForHours
        ? (cpmForHours.hoursData[d.id] || new Array(effectiveWeeks).fill(0))
        : redistributeHours(origHours, baseWeeks, effectiveWeeks);
      const adjTotalHrs = adjHours.reduce((s, h) => s + h, 0);

      // Enhanced cost with MCAA fatigue + stacking (full calculation)
      const adjCost = computeEnhancedCost(origHours, d.rate, d.otRate, otMode, baseWeeks,
        effectiveWeeks, discPF, stackingPenalties, RISK_BANDS.P50, adjHours, discApplyOt);

      // Waterfall: Stage 1 — redistributed hours × base rate only
      wf_redistributedCost += adjTotalHrs * d.rate;

      // Waterfall: Stage 2 — with PF applied, base rate
      wf_costWithPF += adjTotalHrs * d.rate * (1 / discPF);

      // Waterfall: Stage 3 — with PF + OT rates (no MCAA fatigue or stacking)
      const costPFplusOT = computeEnhancedCost(origHours, d.rate, d.otRate, otMode, baseWeeks,
        effectiveWeeks, discPF, null, { pfScale: 1.0, fatigueScale: 0, stackScale: 0 }, adjHours, discApplyOt);
      wf_costWithPFandOT += costPFplusOT;

      const effectiveRate = totalHrs > 0 ? adjCost / totalHrs : d.rate;

      weeklyDirectByDisc[d.id] = {
        baseHours: origHours,
        adjHours,
        totalBaseHours: totalHrs,
        totalAdjHours: adjTotalHrs,
        baseCost,
        adjCost,
        rate: d.rate,
        effectiveRate,
        compressionPF: discPF,
        otActive: discApplyOt,
      };

      totalBaseDirectCost += baseCost;
      totalAdjDirectCost += adjCost;
    });

    // Compute average MCAA fatigue across OT weeks for display
    if (numOtWeeks > 0) {
      let piSum = 0;
      for (let i = 1; i <= numOtWeeks; i++) piSum += getMCAAFatigue(otMode, i);
      avgMCAAFatigue = piSum / numOtWeeks;
    }

    // Compute weighted-average global PF for display purposes
    // Weighted by base cost so larger disciplines have more influence
    let globalPF = uniformPF;
    if (hasPerDiscPF && totalBaseDirectCost > 0) {
      let weightedPFSum = 0;
      disciplines.forEach(d => {
        const baseCost = (hoursData[d.id] || []).reduce((s, h) => s + h, 0) * d.rate;
        const discPF = getDiscPF(d.id);
        weightedPFSum += discPF * baseCost;
      });
      globalPF = weightedPFSum / totalBaseDirectCost;
    }

    const weeklyTimeCostRate = timeCosts.reduce((s, t) => {
      if (t.basis === "weekly") return s + t.rate;
      if (t.basis === "monthly") return s + t.rate / 4.33;
      return s;
    }, 0);

    const baseTimeCost = weeklyTimeCostRate * baseWeeks;
    const adjTimeCost = weeklyTimeCostRate * effectiveWeeks;

    const baseTotalEAC = totalBaseDirectCost + baseTimeCost;
    const adjTotalEAC = totalAdjDirectCost + adjTimeCost;

    const maxW = Math.max(baseWeeks, effectiveWeeks);
    const weeklyData = [];
    const otStartWeek = effectiveWeeks - numOtWeeks;
    for (let w = 0; w < maxW; w++) {
      const pt = { week: w + 1 };
      const weekDate = new Date(startDate);
      weekDate.setDate(weekDate.getDate() + w * 7); snapToSunday(weekDate);
      pt.date = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      let baseDirect = 0;
      let adjDirect = 0;
      disciplines.forEach((d) => {
        const bd = weeklyDirectByDisc[d.id];
        const bh = w < baseWeeks ? (bd.baseHours[w] || 0) : 0;
        const ah = w < effectiveWeeks ? (bd.adjHours[w] || 0) : 0;
        const weekRate = getWeekRate(d.rate, d.otRate, otMode, w, effectiveWeeks, baseWeeks);
        const discPF = getDiscPF(d.id);

        // Per-week multiplier with MCAA fatigue + stacking
        let weekMultiplier = 1 / discPF;
        if (otMode !== "none" && w >= otStartWeek && numOtWeeks > 0 && w < effectiveWeeks) {
          const consecutiveOtWeek = w - otStartWeek + 1;
          const mcaaPI = getMCAAFatigue(otMode, consecutiveOtWeek);
          weekMultiplier *= (1 / mcaaPI);
        }
        if (stackingPenalties && stackingPenalties[w] > 0) {
          weekMultiplier *= (1 + stackingPenalties[w]);
        }

        baseDirect += bh * d.rate;
        adjDirect += ah * weekRate * weekMultiplier;
        pt[`base_${d.id}`] = bh * d.rate;
        pt[`adj_${d.id}`] = ah * weekRate * weekMultiplier;
      });

      const baseTC = w < baseWeeks ? weeklyTimeCostRate : 0;
      const adjTC = w < effectiveWeeks ? weeklyTimeCostRate : 0;

      pt.baseDirect = baseDirect;
      pt.baseTime = baseTC;
      pt.baseTotal = baseDirect + baseTC;
      pt.adjDirect = adjDirect;
      pt.adjTime = adjTC;
      pt.adjTotal = adjDirect + adjTC;
      weeklyData.push(pt);
    }

    let baseCum = 0;
    let adjCum = 0;
    const cumulativeData = weeklyData.map((pt) => {
      baseCum += pt.baseTotal;
      adjCum += pt.adjTotal;
      return { ...pt, baseCumulative: baseCum, adjCumulative: adjCum };
    });

    // Compute Gantt bar spans for each discipline
    const ganttBars = disciplines.map((d) => {
      const origHours = hoursData[d.id] || [];
      const adjHours = weeklyDirectByDisc[d.id]?.adjHours || [];

      let baseStart = -1, baseEnd = -1;
      for (let i = 0; i < origHours.length; i++) {
        if (origHours[i] > 0) { if (baseStart < 0) baseStart = i; baseEnd = i; }
      }
      let adjStart = -1, adjEnd = -1;
      for (let i = 0; i < adjHours.length; i++) {
        if (adjHours[i] > 0) { if (adjStart < 0) adjStart = i; adjEnd = i; }
      }

      return {
        id: d.id,
        name: d.name,
        baseStart: Math.max(baseStart, 0),
        baseEnd: Math.max(baseEnd, 0),
        adjStart: Math.max(adjStart, 0),
        adjEnd: Math.max(adjEnd, 0),
        totalBaseHours: weeklyDirectByDisc[d.id]?.totalBaseHours || 0,
        totalAdjHours: weeklyDirectByDisc[d.id]?.totalAdjHours || 0,
        baseCost: weeklyDirectByDisc[d.id]?.baseCost || 0,
        adjCost: weeklyDirectByDisc[d.id]?.adjCost || 0,
      };
    }).sort((a, b) => a.adjEnd - b.adjEnd);

    // Waterfall decomposition
    const wf_scheduleRedistribution = wf_redistributedCost - totalBaseDirectCost;
    const wf_pfImpact = wf_costWithPF - wf_redistributedCost;
    const wf_otPremium = wf_costWithPFandOT - wf_costWithPF;
    const wf_fatigueAndStacking = totalAdjDirectCost - wf_costWithPFandOT;
    const wf_timeCostDelta = adjTimeCost - baseTimeCost;

    const waterfall = [
      { name: "Original Budget", value: baseTotalEAC, type: "total" },
      { name: "Hours Redistribution", value: wf_scheduleRedistribution, type: "delta" },
      { name: "Productivity Factor", value: wf_pfImpact, type: "delta" },
      { name: "OT Rate Premium", value: wf_otPremium, type: "delta" },
      { name: "Fatigue & Stacking", value: wf_fatigueAndStacking, type: "delta" },
      { name: "Time Cost Δ", value: wf_timeCostDelta, type: "delta" },
      { name: "Adjusted EAC", value: adjTotalEAC, type: "total" },
    ].filter(item => item.type === "total" || Math.abs(item.value) > 0.5);

    // Compute running totals for waterfall rendering
    let wfRunning = 0;
    const waterfallData = waterfall.map((item) => {
      if (item.type === "total") {
        const result = { ...item, start: 0, end: item.value, barStart: 0, barEnd: item.value, visibleHeight: item.value };
        wfRunning = item.value;
        return result;
      }
      const start = wfRunning;
      wfRunning += item.value;
      return { ...item, start, end: wfRunning, barStart: Math.min(start, wfRunning), barEnd: Math.max(start, wfRunning), visibleHeight: Math.abs(item.value) };
    });

    return {
      weeklyDirectByDisc,
      totalBaseDirectCost,
      totalAdjDirectCost,
      baseTimeCost,
      adjTimeCost,
      baseTotalEAC,
      adjTotalEAC,
      weeklyData,
      cumulativeData,
      weeklyTimeCostRate,
      ganttBars,
      taskBars: cpmResult ? cpmResult.taskBars : null,
      otStartWeek: numOtWeeks > 0 ? otStartWeek : -1,
      numOtWeeks,
      compressionPF: globalPF,
      avgMCAAFatigue,
      stackingPenalties,
      waterfallData,
      globalPF,
      effectivePF: globalPF,
      effectiveWeeks,
    };
  }, [disciplines, hoursData, timeCosts, baseWeeks, adjustedWeeks, startDate, maxCompression, maxExtension, otMode, otScope, disciplinePFs, xerSchedule]);

  // End date uses CPM effective weeks (which may differ from slider target due to logic links)
  const adjustedEndDate = new Date(startDate);
  adjustedEndDate.setDate(adjustedEndDate.getDate() + Math.round(forecast.effectiveWeeks * 7) - 1); snapToSunday(adjustedEndDate);

  const deltaEAC = forecast.adjTotalEAC - forecast.baseTotalEAC;
  const deltaPct = forecast.baseTotalEAC > 0 ? (deltaEAC / forecast.baseTotalEAC) * 100 : 0;

  // Compute cost curve across all possible durations to find optimal end date
  // Now includes risk bands (P50/P80/P90) using sensitivity analysis
  const optimization = useMemo(() => {
    // Pre-compute per-discipline base costs and hours
    const discInfo = disciplines.map((d) => {
      const origHours = hoursData[d.id] || new Array(baseWeeks).fill(0);
      const hrs = origHours.reduce((ss, h) => ss + h, 0);
      return { id: d.id, rate: d.rate, otRate: d.otRate, baseCost: hrs * d.rate, hrs, origHours };
    });
    const totalBaseDirectCost = discInfo.reduce((s, di) => s + di.baseCost, 0);

    const weeklyTimeCostRate = timeCosts.reduce((s, t) => {
      if (t.basis === "weekly") return s + t.rate;
      if (t.basis === "monthly") return s + t.rate / 4.33;
      return s;
    }, 0);

    const hasCPM = xerSchedule && xerSchedule.activities && xerSchedule.activities.length > 0;

    const curve = [];
    let minCost = Infinity;
    let optimalWeeks = baseWeeks;

    for (let w = minWeeks; w <= maxWeeks; w++) {
      // CPM task-level compression for this target duration
      let cpmResult = null;
      if (hasCPM && w !== baseWeeks) {
        cpmResult = compressByCPM(xerSchedule, w, baseWeeks, otMode);
      }
      const ew = cpmResult ? cpmResult.achievedWeeks : w; // effective weeks

      // Per-discipline PF from CPM compression data (or uniform fallback)
      const perDiscPFMap = (cpmResult && cpmResult.discCompression && ew < baseWeeks)
        ? getPerDisciplinePF(cpmResult.discCompression)
        : {};
      const hasPerDiscPF = Object.keys(perDiscPFMap).length > 0;

      // Uniform fallback PF (used when no CPM or for extension)
      let uniformPF = 1.0;
      if (ew < baseWeeks) {
        uniformPF = getNonLinearPF(ew, baseWeeks, otCap, hoursData);
      } else if (ew > baseWeeks && maxExtension > 0) {
        const extensionFrac = (ew - baseWeeks) / maxExtension;
        uniformPF = 1.0 + (EXTENSION_PF - 1.0) * extensionFrac;
      }

      const getDiscPFOpt = (discId) => hasPerDiscPF ? (perDiscPFMap[discId] || 1.0) : uniformPF;
      const getDiscApplyOt = (discId) => {
        if (otScope === "zone") return true;
        return hasPerDiscPF ? (perDiscPFMap[discId] !== undefined && perDiscPFMap[discId] < 1.0) : (ew < baseWeeks);
      };

      // Stacking penalties for this duration (using CPM hours when available)
      const cpmAdj = cpmResult ? cpmResult.hoursData : null;
      const stackPenalties = computeStackingPenalties(hoursData, baseWeeks, ew, cpmAdj);

      // P50 cost (base/expected)
      const directCost = discInfo.reduce((s, di) => {
        const adjH = cpmResult ? (cpmResult.hoursData[di.id] || []) : null;
        const discPF = getDiscPFOpt(di.id);
        return s + computeEnhancedCost(di.origHours, di.rate, di.otRate, otMode, baseWeeks, ew,
          discPF, stackPenalties, RISK_BANDS.P50, adjH, getDiscApplyOt(di.id));
      }, 0);

      // P80 cost (pessimistic)
      const directCostP80 = discInfo.reduce((s, di) => {
        const adjH = cpmResult ? (cpmResult.hoursData[di.id] || []) : null;
        const discPF = getDiscPFOpt(di.id);
        const pfP80 = ew < baseWeeks ? (1.0 + (discPF - 1.0) * RISK_BANDS.P80.pfScale) : discPF;
        return s + computeEnhancedCost(di.origHours, di.rate, di.otRate, otMode, baseWeeks, ew,
          pfP80, stackPenalties, RISK_BANDS.P80, adjH, getDiscApplyOt(di.id));
      }, 0);

      // P90 cost (very pessimistic)
      const directCostP90 = discInfo.reduce((s, di) => {
        const adjH = cpmResult ? (cpmResult.hoursData[di.id] || []) : null;
        const discPF = getDiscPFOpt(di.id);
        const pfP90 = ew < baseWeeks ? (1.0 + (discPF - 1.0) * RISK_BANDS.P90.pfScale) : discPF;
        return s + computeEnhancedCost(di.origHours, di.rate, di.otRate, otMode, baseWeeks, ew,
          pfP90, stackPenalties, RISK_BANDS.P90, adjH, getDiscApplyOt(di.id));
      }, 0);

      // Weighted-average PF for display in curve data
      let effectivePF = uniformPF;
      if (hasPerDiscPF && totalBaseDirectCost > 0) {
        let weightedSum = 0;
        discInfo.forEach(di => { weightedSum += getDiscPFOpt(di.id) * di.baseCost; });
        effectivePF = weightedSum / totalBaseDirectCost;
      }

      const calW = ew;
      const timeCost = weeklyTimeCostRate * calW;
      const totalCost = directCost + timeCost;
      const totalCostP80 = directCostP80 + timeCost;
      const totalCostP90 = directCostP90 + timeCost;

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + Math.round(calW * 7) - 1); snapToSunday(endDate);

      curve.push({
        weeks: w,
        calWeeks: Math.round(calW * 10) / 10,
        weekOffset: w - baseWeeks,
        directCost,
        timeCost,
        totalCost,
        totalCostP80,
        totalCostP90,
        endDate: endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
        isBaseline: w === baseWeeks,
        isCurrent: w === adjustedWeeks,
        effectivePF,
      });

      if (totalCost < minCost) {
        minCost = totalCost;
        optimalWeeks = w;
      }
    }

    const optimalCalW = optimalWeeks;
    const optimalEndDate = new Date(startDate);
    optimalEndDate.setDate(optimalEndDate.getDate() + Math.round(optimalCalW * 7) - 1); snapToSunday(optimalEndDate);
    const baselineTotalCost = curve.find((c) => c.isBaseline)?.totalCost || 0;
    const currentTotalCost = curve.find((c) => c.isCurrent)?.totalCost || 0;
    const currentP80 = curve.find((c) => c.isCurrent)?.totalCostP80 || 0;
    const currentP90 = curve.find((c) => c.isCurrent)?.totalCostP90 || 0;
    const savingsVsCurrent = currentTotalCost - minCost;
    const savingsVsBaseline = baselineTotalCost - minCost;

    return {
      curve,
      optimalWeeks,
      optimalCost: minCost,
      optimalEndDate: optimalEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      optimalOffset: optimalWeeks - baseWeeks,
      savingsVsCurrent,
      savingsVsBaseline,
      baselineTotalCost,
      currentTotalCost,
      currentP80,
      currentP90,
    };
  }, [disciplines, hoursData, timeCosts, baseWeeks, adjustedWeeks, minWeeks, maxWeeks, maxCompression, maxExtension, startDate, otMode, otScope, xerSchedule]);

  const timeCostBreakdown = timeCosts.map((t) => {
    const weeklyRate = t.basis === "weekly" ? t.rate : t.rate / 4.33;
    return {
      ...t,
      baseCost: weeklyRate * baseWeeks,
      adjCost: weeklyRate * calendarWeeks,
      delta: weeklyRate * calendarWeeks - weeklyRate * baseWeeks,
    };
  });

  // Register export function so App header can trigger it
  useEffect(() => {
    if (exportRef) {
      exportRef.current = () => {
        exportPDF(forecast, optimization, disciplines, timeCosts, baseWeeks, adjustedWeeks, calendarWeeks, startDate, otMode, otScope, disciplinePFs, hoursData, xerSchedule);
      };
    }
    // If a pending export was requested (e.g., clicked from another tab), fire it now
    if (pendingExport && pendingExport.current) {
      pendingExport.current = false;
      setTimeout(() => { if (exportRef.current) exportRef.current(); }, 50);
    }
    return () => { if (exportRef) exportRef.current = null; };
  });

  // ─── Render Helpers (decomposed from monolithic return) ─────────────────

  const renderKPICards = () => (
    <>
      {/* Primary KPI Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16, alignItems: "stretch" }} aria-label="Key performance indicators" role="region">
        <div style={styles.metric(COLORS.accent)}>
          <div style={styles.metricValue}>{formatCurrency(forecast.adjTotalEAC)}</div>
          <div style={styles.metricLabel}>Forecast EAC</div>
          <div style={styles.metricDelta(deltaEAC <= 0)}>
            {deltaEAC === 0 ? "No change" : `${deltaEAC > 0 ? "+" : ""}${formatCurrency(deltaEAC)} (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`}
          </div>
        </div>
        <div style={styles.metric(COLORS.blue)}>
          <div style={styles.metricValue}>{formatCurrency(forecast.totalAdjDirectCost)}</div>
          <div style={styles.metricLabel}>Direct Cost</div>
          <div style={styles.metricDelta(forecast.totalAdjDirectCost <= forecast.totalBaseDirectCost)}>
            {weekOffset === 0 && otMode === "none" ? "Baseline" : `${forecast.totalAdjDirectCost > forecast.totalBaseDirectCost ? "+" : ""}${formatCurrency(forecast.totalAdjDirectCost - forecast.totalBaseDirectCost)}`}
          </div>
        </div>
        <div style={styles.metric(COLORS.accent)}>
          <div style={styles.metricValue}>{formatCurrency(forecast.adjTimeCost)}</div>
          <div style={styles.metricLabel}>Time-Based Cost</div>
          <div style={styles.metricDelta(forecast.adjTimeCost <= forecast.baseTimeCost)}>
            {weekOffset === 0 && otMode === "none" ? "Baseline" : `${forecast.adjTimeCost > forecast.baseTimeCost ? "+" : ""}${formatCurrency(forecast.adjTimeCost - forecast.baseTimeCost)}`}
          </div>
        </div>
        <div style={styles.metric(COLORS.textDim)}>
          <div style={styles.metricValue}>{formatCurrency(forecast.baseTotalEAC)}</div>
          <div style={styles.metricLabel}>Original Budget</div>
        </div>
      </div>
    </>
  );

  return (
    <div>

      {/* ── KPI Cards (decomposed) ── */}
      {renderKPICards()}

      {/* Enhanced Model Factors — only show when compression is active */}
      {(adjustedWeeks < baseWeeks || forecast.numOtWeeks > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <div style={styles.metric(COLORS.text)}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Non-Linear PF</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: forecast.effectivePF < 0.92 ? COLORS.red : forecast.effectivePF < 1 ? COLORS.accent : COLORS.text }}>
              {forecast.effectivePF.toFixed(3)}
            </div>
            <div style={{ fontSize: 10, color: COLORS.textDim }}>BRT/MCAA power curve (α={PF_CURVE_ALPHA})</div>
          </div>
          <div style={styles.metric(forecast.numOtWeeks > 0 ? COLORS.orange : COLORS.border)}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>MCAA Avg Fatigue</div>
            {forecast.numOtWeeks > 0 ? (
              <>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: COLORS.orange }}>
                  PI {forecast.avgMCAAFatigue.toFixed(3)}
                </div>
                <div style={{ fontSize: 10, color: COLORS.textDim }}>{forecast.numOtWeeks} OT wks ({otMode === "sat" ? "50" : "60"} hr/wk)</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: COLORS.textMuted }}>—</div>
                <div style={{ fontSize: 10, color: COLORS.textMuted }}>No OT active</div>
              </>
            )}
          </div>
          <div style={styles.metric(forecast.stackingPenalties ? (COLORS.purple || "#a78bfa") : COLORS.border)}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Trade Stacking</div>
            {forecast.stackingPenalties ? (
              <>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: COLORS.purple || "#a78bfa" }}>
                  +{(Math.max(...forecast.stackingPenalties) * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: COLORS.textDim }}>Peak congestion penalty</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: COLORS.textMuted }}>—</div>
                <div style={{ fontSize: 10, color: COLORS.textMuted }}>No stacking detected</div>
              </>
            )}
          </div>
          <div style={styles.metric(COLORS.red)}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>P80 Risk Range</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: COLORS.red }}>
              {formatCurrency(optimization.currentP80)}
            </div>
            <div style={{ fontSize: 10, color: COLORS.textDim }}>P90: {formatCurrency(optimization.currentP90)}</div>
          </div>
        </div>
      )}

      {/* Cumulative S-Curve */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={styles.cardTitle}>Cumulative Cost (S-Curve)</div>
          {adjustedWeeks !== baseWeeks && (
            <div style={{ fontSize: 12, fontWeight: 600, color: adjustedWeeks < baseWeeks ? COLORS.green : COLORS.red, fontFamily: FONT }}>
              {adjustedWeeks < baseWeeks ? `${baseWeeks - adjustedWeeks} weeks earlier` : `${adjustedWeeks - baseWeeks} weeks later`}
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={forecast.cumulativeData}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis
              dataKey="date"
              stroke={COLORS.textMuted}
              tick={{ fontSize: 9 }}
              interval={Math.max(0, Math.floor(forecast.cumulativeData.length / 8) - 1)}
            />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip
              contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
              formatter={(v) => formatCurrency(v)}
            />
            <ReferenceLine
              x={(() => { const d = new Date(startDate); d.setDate(d.getDate() + (baseWeeks - 1) * 7); snapToSunday(d); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); })()}
              stroke={COLORS.textMuted}
              strokeDasharray="5 5"
              label={{ value: `Base End`, position: "top", fontSize: 9, fill: COLORS.textDim, dy: -10 }}
            />
            {adjustedWeeks !== baseWeeks && (
              <ReferenceLine
                x={(() => { const d = new Date(startDate); d.setDate(d.getDate() + (adjustedWeeks - 1) * 7); snapToSunday(d); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); })()}
                stroke={COLORS.accent}
                strokeDasharray="5 5"
                label={{ value: `Adj End`, position: "top", fontSize: 9, fill: COLORS.accent, dy: -10 }}
              />
            )}
            <Line type="monotone" dataKey="baseCumulative" name="Base EAC" stroke={COLORS.textMuted} strokeWidth={2} strokeDasharray="6 4" dot={false} />
            <Line type="monotone" dataKey="adjCumulative" name="Adjusted EAC" stroke={COLORS.accent} strokeWidth={2.5} dot={false} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Variance Waterfall Chart */}
      {(weekOffset !== 0 || otMode !== "none") && forecast.waterfallData && forecast.waterfallData.length > 2 && (
        <div style={styles.card}>
          <div>
            <div style={styles.cardTitle}>EAC Variance Waterfall</div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: -8 }}>Decomposition of cost changes from baseline to adjusted EAC</div>
          </div>
          <div style={{ position: "relative" }}>
            <ResponsiveContainer width="100%" height={Math.max(200, forecast.waterfallData.length * 36 + 40)}>
              <BarChart
                data={forecast.waterfallData}
                layout="vertical"
                margin={{ top: 8, right: 80, bottom: 8, left: 10 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
                <XAxis
                  type="number"
                  stroke={COLORS.textMuted}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatCurrency(v)}
                  domain={[0, "auto"]}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={COLORS.textMuted}
                  tick={{ fontSize: 11, fill: COLORS.textDim, fontFamily: FONT }}
                  width={140}
                />
                <Tooltip
                  contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
                  formatter={(v, name, props) => {
                    const item = props.payload;
                    if (item.type === "total") return [formatCurrency(item.value), "Total"];
                    return [
                      `${item.value >= 0 ? "+" : ""}${formatCurrency(item.value)}`,
                      item.value >= 0 ? "Cost Increase" : "Cost Savings"
                    ];
                  }}
                  labelFormatter={(label) => label}
                />
                {/* Invisible bar from 0 to start (connector) */}
                <Bar dataKey="barStart" stackId="waterfall" fill="transparent" />
                {/* Visible bar showing the delta or total */}
                <Bar dataKey="visibleHeight" stackId="waterfall" radius={[0, 3, 3, 0]}>
                  {forecast.waterfallData.map((entry, index) => {
                    let fill;
                    if (entry.type === "total") fill = COLORS.blue;
                    else if (entry.value >= 0) fill = COLORS.red;
                    else fill = COLORS.green;
                    return <Cell key={index} fill={fill} fillOpacity={entry.type === "total" ? 0.85 : 0.7} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* Value labels */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
              {forecast.waterfallData.map((item, i) => (
                <div key={i} style={{
                  position: "absolute",
                  right: 4,
                  top: `${((i + 0.5) / forecast.waterfallData.length) * 100}%`,
                  transform: "translateY(-50%)",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: FONT,
                  color: item.type === "total" ? COLORS.text : item.value >= 0 ? COLORS.red : COLORS.green,
                  textAlign: "right",
                  paddingRight: 4,
                }}>
                  {item.type === "total" ? formatCurrency(item.value) : `${item.value >= 0 ? "+" : ""}${formatCurrency(item.value)}`}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Optimal End Date */}
      <div style={{ ...styles.card, borderColor: COLORS.green + "66", background: `linear-gradient(135deg, ${COLORS.greenDim}15, ${COLORS.surface})` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ ...styles.cardTitle, color: COLORS.green }}>⬣ Lowest Cost End Date</div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: -8 }}>
              Cost curve across all durations — balancing acceleration premiums against time-based cost growth
              {otMode !== "none" && (
                <span style={{ color: COLORS.orange, fontWeight: 600 }}> · {OT_MODES[otMode]} OT enabled ({getOtCapacity(otMode).hrsPerWeek} hrs/wk)</span>
              )}
            </div>
          </div>
          {optimization.optimalWeeks !== adjustedWeeks && (
            <button
              style={{ ...styles.btn("primary"), background: COLORS.green, display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setWeekOffset(optimization.optimalOffset)}
            >
              ↗ Snap to Optimal
            </button>
          )}
        </div>

        {/* Optimal metrics strip */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ ...styles.metric(COLORS.green), flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Optimal Duration</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.green }}>{optimization.optimalWeeks} weeks</div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
              {optimization.optimalOffset === 0 ? "At baseline" : `${optimization.optimalOffset > 0 ? "+" : ""}${optimization.optimalOffset} wks from base`}
              {otMode !== "none" && optimization.optimalOffset < 0 && ` · ${getOtWeeks(optimization.optimalWeeks, baseWeeks, otMode)} OT wks`}
            </div>
          </div>
          <div style={{ ...styles.metric(COLORS.green), flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Optimal End Date</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.green }}>{optimization.optimalEndDate}</div>
            {otMode !== "none" && optimization.optimalOffset < 0 && (
              <div style={{ fontSize: 12, color: COLORS.orange, marginTop: 2 }}>
                PF: {getNonLinearPF(optimization.optimalWeeks, baseWeeks, otCap, hoursData).toFixed(2)} · {Math.round(getOtUtilization(optimization.optimalWeeks, baseWeeks, otMode) * 100)}% OT util
              </div>
            )}
          </div>
          <div style={{ ...styles.metric(COLORS.green), flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Lowest EAC</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.green }}>{formatCurrency(optimization.optimalCost)}</div>
          </div>
          <div style={{ ...styles.metric(optimization.savingsVsCurrent > 0 ? COLORS.red : COLORS.green), flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Current vs Optimal</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: optimization.savingsVsCurrent > 0 ? COLORS.red : COLORS.green }}>
              {optimization.savingsVsCurrent > 0 ? `+${formatCurrency(optimization.savingsVsCurrent)}` : optimization.savingsVsCurrent === 0 ? "—" : formatCurrency(-optimization.savingsVsCurrent)}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
              {optimization.savingsVsCurrent > 0
                ? `${((optimization.savingsVsCurrent / optimization.currentTotalCost) * 100).toFixed(1)}% above optimal`
                : optimization.optimalWeeks === adjustedWeeks ? "At optimum" : "At optimum"}
            </div>
          </div>
        </div>

        {/* Toggle for cost curve chart */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: showCostCurve ? 12 : 0, padding: "4px 0" }}
          onClick={() => setShowCostCurve(!showCostCurve)}
        >
          <span style={{ fontSize: 10, color: COLORS.textDim, transform: showCostCurve ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
          <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {showCostCurve ? "Hide" : "Show"} Cost Curve
          </span>
        </div>

        {showCostCurve && (<>
        {/* Cost curve chart with risk bands */}
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={optimization.curve} margin={{ top: 25, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis
              dataKey="calWeeks"
              stroke={COLORS.textMuted}
              tick={{ fontSize: 10 }}
              type="number"
              domain={["dataMin", "dataMax"]}
              label={{ value: "Duration (weeks)", position: "insideBottom", offset: -2, fontSize: 11, fill: COLORS.textDim }}
            />
            <YAxis
              stroke={COLORS.textMuted}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatCurrency(v)}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
              formatter={(v, name) => [formatCurrency(v), name]}
              labelFormatter={(l) => {
                const pt = optimization.curve.find((c) => c.calWeeks === l);
                return pt ? `Week ${pt.calWeeks} — ${pt.endDate}` : `Week ${l}`;
              }}
            />
            {/* P90 risk band (outermost) */}
            <Area type="monotone" dataKey="totalCostP90" name="P90 Risk" stroke="none" fill={COLORS.red} fillOpacity={0.08} />
            {/* P80 risk band */}
            <Area type="monotone" dataKey="totalCostP80" name="P80 Risk" stroke={COLORS.red + "44"} fill={COLORS.red} fillOpacity={0.10} strokeWidth={1} strokeDasharray="4 3" />
            <Area type="monotone" dataKey="timeCost" name="Time-Based Cost" stroke={COLORS.accent + "88"} fill={COLORS.accent} fillOpacity={0.15} strokeWidth={1.5} />
            <Area type="monotone" dataKey="directCost" name="Direct Cost" stroke={COLORS.blue + "88"} fill={COLORS.blue} fillOpacity={0.15} strokeWidth={1.5} />
            <Line type="monotone" dataKey="totalCost" name="P50 EAC (Expected)" stroke={COLORS.text} strokeWidth={2.5} dot={false} />
            <ReferenceLine
              x={baseWeeks}
              stroke={COLORS.textMuted}
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: `Base End (${snapToSunday(new Date(new Date(startDate).getTime() + (baseWeeks * 7 - 1) * 86400000)).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`, position: "insideTopRight", fontSize: 9, fill: COLORS.textDim, offset: 4 }}
            />
            <ReferenceLine
              x={Math.round(optimization.optimalWeeks * 10) / 10}
              stroke={COLORS.green}
              strokeWidth={2}
              strokeDasharray="4 3"
              label={{ value: `Optimal: ${Math.round(optimization.optimalWeeks)}wk`, position: "top", fontSize: 10, fill: COLORS.green }}
            />
            {adjustedWeeks !== optimization.optimalWeeks && adjustedWeeks !== baseWeeks && (
              <ReferenceLine
                x={Math.round(adjustedWeeks * 10) / 10}
                stroke={COLORS.accent}
                strokeDasharray="5 5"
                label={{ value: "Current", position: "insideTopRight", fontSize: 9, fill: COLORS.accent }}
              />
            )}
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>

        <div style={{ marginTop: 8, fontSize: 11, color: COLORS.textDim, lineHeight: 1.6, padding: "0 4px" }}>
          <strong style={{ color: COLORS.textDim }}>Enhanced Model:</strong>{" "}
          <strong>① Non-Linear PF</strong> (power curve α={PF_CURVE_ALPHA}, fitted to BRT/MCAA data): gentle loss at low compression, steep at high. Max PF = {ACCEL_PF} at full compression.
          {" "}<strong>② MCAA OT Fatigue</strong> (Bulletin OT1, 2011 — averaged BRT, NECA, Thomas, COE): per-week PI decay from{" "}
          {otMode === "sat" ? "0.95→0.62" : otMode === "satSun" ? "0.91→0.45" : "N/A"} over consecutive OT weeks.
          {" "}<strong>③ Trade Stacking</strong> (Hanna 2007, MCAA Factor Model): {STACKING_K * 100}%/trade incremental congestion penalty beyond baseline, capped at {STACKING_MAX * 100}%.
          {" "}<strong>④ Risk Bands</strong> (AACE RP 42R-08): P80/P90 shaded zones scale fatigue and stacking ×{RISK_BANDS.P80.fatigueScale}/{RISK_BANDS.P90.fatigueScale}.
          {forecast.effectivePF !== 1 && <>{" "}Current PF: <strong style={{ color: forecast.effectivePF < 1 ? COLORS.red : COLORS.green }}>{forecast.effectivePF.toFixed(3)}</strong>.</>}
          {forecast.avgMCAAFatigue < 1 && <>{" "}Avg MCAA PI: <strong style={{ color: COLORS.orange }}>{forecast.avgMCAAFatigue.toFixed(3)}</strong> across {forecast.numOtWeeks} OT weeks.</>}
          {otMode === "none" 
            ? <>{" "}<strong style={{ color: COLORS.textMuted }}>Overtime:</strong> No OT selected — schedule acceleration is disabled. Enable Sat OT or Sat/Sun OT to compress the schedule.</>
            : <>{" "}<strong style={{ color: COLORS.orange }}>Overtime ({OT_MODES[otMode]}):</strong> {otMode === "sat" ? "6-day work week (60 hrs/wk)" : "7-day work week (70 hrs/wk)"}. OT ramps progressively — more compression = more OT weeks, with cumulative fatigue per MCAA tables.</>}
        </div>
        </>)}
      </div>

      {/* Gantt Chart */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Schedule — Discipline & Time-Based Costs</div>
        {(() => {
          const maxWeek = Math.max(baseWeeks, adjustedWeeks);
          const labelWidth = 200;
          const rightPad = 90;
          const barAreaWidth = `calc(100% - ${labelWidth + rightPad}px)`;
          const rowHeight = 40;
          const barHeight = 16;
          const baseBarHeight = 8;

          const getWeekDate = (w) => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + w * 7); snapToSunday(d);
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          };

          const tickInterval = maxWeek <= 30 ? 4 : maxWeek <= 60 ? 8 : maxWeek <= 100 ? 12 : 16;
          const ticks = [];
          for (let w = 0; w <= maxWeek; w += tickInterval) ticks.push(w);
          if (ticks[ticks.length - 1] !== maxWeek) ticks.push(maxWeek);

          const allRows = [
            ...(forecast.ganttBars || []).map((bar) => {
              const origIdx = disciplines.findIndex(d => d.id === bar.id);
              return {
              type: "discipline",
              label: bar.name,
              color: DISCIPLINE_COLORS[origIdx >= 0 ? origIdx % DISCIPLINE_COLORS.length : 0],
              baseStart: bar.baseStart,
              baseEnd: bar.baseEnd + 1,
              adjStart: bar.adjStart,
              adjEnd: bar.adjEnd + 1,
              rightLabel: formatCurrency(bar.adjCost),
              delta: bar.adjCost - bar.baseCost,
              otStart: forecast.otStartWeek,
              totalBaseHours: bar.totalBaseHours,
              totalAdjHours: bar.totalAdjHours,
              baseCost: bar.baseCost,
              adjCost: bar.adjCost,
            };}),
            {
              type: "time",
              label: "Time-Based Costs",
              color: COLORS.accent,
              baseStart: 0,
              baseEnd: baseWeeks,
              adjStart: 0,
              adjEnd: adjustedWeeks,
              rightLabel: formatCurrency(forecast.adjTimeCost),
              delta: forecast.adjTimeCost - forecast.baseTimeCost,
              otStart: -1,
              baseCost: forecast.baseTimeCost,
              adjCost: forecast.adjTimeCost,
            },
          ];

          return (
            <div style={{ overflowX: "auto", position: "relative" }}>
              {/* Gantt tooltip */}
              {ganttTooltip && (() => {
                const r = ganttTooltip.row;
                const otWeeks = r.otStart >= 0 ? Math.max(0, r.adjEnd - Math.max(r.otStart, r.adjStart)) : 0;
                return (
                  <div style={{
                    position: "fixed",
                    left: ganttTooltip.x + 16,
                    top: ganttTooltip.y + 16,
                    background: COLORS.surface,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 6,
                    padding: "10px 14px",
                    fontSize: 11,
                    color: COLORS.text,
                    zIndex: 100,
                    pointerEvents: "none",
                    boxShadow: `0 4px 16px ${COLORS.bg}cc`,
                    minWidth: 200,
                    lineHeight: 1.7,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: ganttTooltip.row.color }}>{r.label}</div>
                    <div>Base: Wk {r.baseStart}–{r.baseEnd - 1} <span style={{ color: COLORS.textDim }}>({r.baseEnd - r.baseStart} wks · {getWeekDate(r.baseStart)} – {getWeekDate(r.baseEnd - 1)})</span></div>
                    <div>Adj: Wk {r.adjStart}–{r.adjEnd - 1} <span style={{ color: COLORS.textDim }}>({r.adjEnd - r.adjStart} wks · {getWeekDate(r.adjStart)} – {getWeekDate(r.adjEnd - 1)})</span></div>
                    {r.adjEnd !== r.baseEnd && (
                      <div style={{ color: r.adjEnd < r.baseEnd ? COLORS.green : COLORS.red, fontWeight: 600 }}>
                        Δ {r.baseEnd - r.baseStart - (r.adjEnd - r.adjStart)} wks {r.adjEnd < r.baseEnd ? "compressed" : "extended"}
                      </div>
                    )}
                    {r.type === "discipline" && r.totalBaseHours != null && (
                      <div style={{ marginTop: 2 }}>Hours: {r.totalBaseHours.toLocaleString()}{r.totalAdjHours !== r.totalBaseHours ? ` → ${r.totalAdjHours.toLocaleString()}` : ""}</div>
                    )}
                    <div>Base Cost: {formatCurrency(r.baseCost)}</div>
                    <div>Adj Cost: <span style={{ fontWeight: 600 }}>{formatCurrency(r.adjCost)}</span>
                      {r.delta !== 0 && <span style={{ color: r.delta > 0 ? COLORS.red : COLORS.green, fontWeight: 600 }}> ({r.delta > 0 ? "+" : ""}{formatCurrency(r.delta)})</span>}
                    </div>
                    {otWeeks > 0 && (
                      <div style={{ color: COLORS.orange, fontWeight: 600, marginTop: 2 }}>
                        OT: {otWeeks} of {r.adjEnd - r.adjStart} wks ({Math.round(otWeeks / (r.adjEnd - r.adjStart) * 100)}%)
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Time axis */}
              <div style={{ display: "flex", marginBottom: 2 }}>
                <div style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0 }} />
                <div style={{ flex: 1, position: "relative", height: 22 }}>
                  {ticks.map((w) => (
                    <div key={w} style={{
                      position: "absolute",
                      left: `${(w / maxWeek) * 100}%`,
                      transform: "translateX(-50%)",
                      fontSize: 9,
                      color: COLORS.textMuted,
                      whiteSpace: "nowrap",
                      textAlign: "center",
                      lineHeight: 1,
                    }}>
                      <div>Wk {w}</div>
                      <div style={{ fontSize: 8, color: COLORS.textMuted + "88", marginTop: 1 }}>{getWeekDate(w)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ width: rightPad, minWidth: rightPad, flexShrink: 0 }} />
              </div>

              {/* Rows */}
              {allRows.map((row, idx) => {
                const baseLeftPct = (row.baseStart / maxWeek) * 100;
                const baseWidthPct = ((row.baseEnd - row.baseStart) / maxWeek) * 100;
                const adjLeftPct = (row.adjStart / maxWeek) * 100;
                const adjWidthPct = ((row.adjEnd - row.adjStart) / maxWeek) * 100;
                const isExtended = row.adjEnd > row.baseEnd;
                const isCompressed = row.adjEnd < row.baseEnd;
                const extStart = Math.min(row.baseEnd, row.adjEnd);
                const extEnd = Math.max(row.baseEnd, row.adjEnd);
                const extLeftPct = (extStart / maxWeek) * 100;
                const extWidthPct = ((extEnd - extStart) / maxWeek) * 100;

                return (
                  <div key={idx} style={{
                    display: "flex",
                    alignItems: "center",
                    height: rowHeight,
                    borderBottom: `1px solid ${COLORS.border}22`,
                    background: idx % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}33`,
                  }}>
                    {/* Label */}
                    <div style={{
                      width: labelWidth,
                      minWidth: labelWidth,
                      flexShrink: 0,
                      paddingLeft: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.text,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <span style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: row.type === "time" ? 2 : 2,
                        background: row.color,
                        flexShrink: 0,
                      }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                    </div>

                    {/* Bar area */}
                    <div
                      style={{ flex: 1, position: "relative", height: "100%" }}
                      onMouseEnter={(e) => {
                        setGanttTooltip({ row, x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => {
                        setGanttTooltip((prev) => prev ? { ...prev, row, x: e.clientX, y: e.clientY } : null);
                      }}
                      onMouseLeave={() => setGanttTooltip(null)}
                    >
                      {/* Grid lines */}
                      {ticks.map((w) => (
                        <div key={w} style={{
                          position: "absolute",
                          left: `${(w / maxWeek) * 100}%`,
                          top: 0,
                          bottom: 0,
                          width: 1,
                          background: `${COLORS.border}44`,
                        }} />
                      ))}

                      {/* Base end marker (dashed line at original end) */}
                      {weekOffset !== 0 && (
                        <div style={{
                          position: "absolute",
                          left: `${(row.baseEnd / maxWeek) * 100}%`,
                          top: 4,
                          bottom: 4,
                          width: 1,
                          borderLeft: `2px dashed ${COLORS.textMuted}55`,
                          zIndex: 2,
                        }} />
                      )}

                      {/* Baseline bar (P6-style, underneath) */}
                      {weekOffset !== 0 && (
                        <div style={{
                          position: "absolute",
                          left: `${baseLeftPct}%`,
                          width: `${baseWidthPct}%`,
                          top: "50%",
                          marginTop: barHeight / 2 + 2,
                          height: baseBarHeight,
                          background: `${COLORS.textMuted}30`,
                          borderRadius: 2,
                          zIndex: 0,
                          border: `1px solid ${COLORS.textMuted}25`,
                          transition: "left 0.3s, width 0.3s",
                        }} />
                      )}

                      {/* Adjusted bar (main solid bar) */}
                      <div style={{
                        position: "absolute",
                        left: `${adjLeftPct}%`,
                        width: `${adjWidthPct}%`,
                        top: "50%",
                        transform: "translateY(-60%)",
                        height: barHeight,
                        background: `linear-gradient(90deg, ${row.color}cc, ${row.color}aa)`,
                        borderRadius: 3,
                        zIndex: 1,
                        boxShadow: `0 1px 4px ${row.color}33`,
                        transition: "left 0.3s, width 0.3s",
                      }} />

                      {/* OT hatch overlay */}
                      {row.otStart >= 0 && row.otStart < row.adjEnd && (() => {
                        const otClipStart = Math.max(row.otStart, row.adjStart);
                        const otClipEnd = row.adjEnd;
                        if (otClipStart >= otClipEnd) return null;
                        const otLeftPct = (otClipStart / maxWeek) * 100;
                        const otWidthPct = ((otClipEnd - otClipStart) / maxWeek) * 100;
                        return (
                          <div style={{
                            position: "absolute",
                            left: `${otLeftPct}%`,
                            width: `${otWidthPct}%`,
                            top: "50%",
                            transform: "translateY(-60%)",
                            height: barHeight,
                            background: `repeating-linear-gradient(45deg, #000000aa, #000000aa 4px, ${row.color}88 4px, ${row.color}88 8px)`,
                            borderRadius: 3,
                            zIndex: 2,
                            transition: "left 0.3s, width 0.3s",
                            pointerEvents: "none",
                          }} />
                        );
                      })()}
                    </div>

                    {/* Right cost label */}
                    <div style={{
                      width: rightPad,
                      minWidth: rightPad,
                      flexShrink: 0,
                      textAlign: "right",
                      paddingRight: 8,
                      fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 600, color: COLORS.text }}>{row.rightLabel}</div>
                      {row.delta !== 0 && (
                        <div style={{ fontSize: 10, color: row.delta > 0 ? COLORS.red : COLORS.green, fontWeight: 600 }}>
                          {row.delta > 0 ? "+" : ""}{formatCurrency(row.delta)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Total row */}
              <div style={{
                display: "flex",
                alignItems: "center",
                height: rowHeight,
                borderTop: `2px solid ${COLORS.border}`,
                marginTop: 2,
              }}>
                <div style={{
                  width: labelWidth,
                  minWidth: labelWidth,
                  flexShrink: 0,
                  paddingLeft: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: COLORS.accent,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>
                  Total EAC
                </div>
                <div style={{ flex: 1 }} />
                <div style={{
                  width: rightPad,
                  minWidth: rightPad,
                  flexShrink: 0,
                  textAlign: "right",
                  paddingRight: 8,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.accent }}>{formatCurrency(forecast.adjTotalEAC)}</div>
                  {deltaEAC !== 0 && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: deltaEAC > 0 ? COLORS.red : COLORS.green }}>
                      {deltaEAC > 0 ? "+" : ""}{formatCurrency(deltaEAC)}
                    </div>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 20, marginTop: 10, paddingLeft: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: COLORS.textDim }}>
                  <div style={{ width: 20, height: 4, background: COLORS.blue, borderRadius: 2 }} />
                  Adjusted Duration
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: COLORS.textDim }}>
                  <div style={{ width: 20, height: 0, borderTop: `2px dashed ${COLORS.textMuted}55` }} />
                  Base End
                </div>
                {weekOffset > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ width: 20, height: 10, background: `repeating-linear-gradient(45deg, ${COLORS.red}33, ${COLORS.red}33 3px, transparent 3px, transparent 6px)`, border: `1px dashed ${COLORS.red}66`, borderRadius: 2 }} />
                    Extension
                  </div>
                )}
                {weekOffset < 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ width: 20, height: 10, background: `repeating-linear-gradient(45deg, ${COLORS.green}33, ${COLORS.green}33 3px, transparent 3px, transparent 6px)`, border: `1px dashed ${COLORS.green}66`, borderRadius: 2 }} />
                    Compression
                  </div>
                )}
                {forecast.numOtWeeks > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ width: 20, height: 10, background: `${COLORS.blue}88`, borderRadius: 2, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(45deg, #000000aa, #000000aa 3px, ${COLORS.blue}88 3px, ${COLORS.blue}88 6px)` }} />
                    </div>
                    OT Weeks ({forecast.numOtWeeks})
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Task-Level Accelerated Schedule */}
      {forecast.taskBars && forecast.taskBars.length > 0 && (
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={styles.cardTitle}>Schedule — Task-Level Acceleration</div>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: -8 }}>
              Individual tasks compressed via CPM forward pass · {forecast.taskBars.length} tasks · {xerSchedule ? (xerSchedule.relationships || []).length : 0} logic links · sorted by finish date
            </div>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 8px" }}
            onClick={() => setShowTaskSchedule(!showTaskSchedule)}
          >
            <span style={{ fontSize: 10, color: COLORS.textDim, transform: showTaskSchedule ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
            <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {showTaskSchedule ? "Hide" : "Show"}
            </span>
          </div>
        </div>

        {showTaskSchedule && (() => {
          const totalBaseDays = baseWeeks * 7;
          const totalAdjDays = adjustedWeeks * 7;
          const maxDay = Math.max(totalBaseDays, totalAdjDays, ...forecast.taskBars.map(t => Math.max(t.baseEndDay, t.adjEndDay)));
          const maxWeekDisp = Math.ceil(maxDay / 7);
          const labelWidth = 220;
          const rightPad = 100;
          const rowHeight = 32;
          const barHeight = 13;
          const groupRowHeight = 30;
          const otStartWeek = forecast.otStartWeek;
          const otStartDay = otStartWeek >= 0 ? otStartWeek * 7 : -1;

          const getWeekDate = (w) => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + w * 7); snapToSunday(d);
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          };

          const tickInterval = maxWeekDisp <= 15 ? 1 : maxWeekDisp <= 30 ? 2 : maxWeekDisp <= 60 ? 4 : 8;
          const ticks = [];
          for (let w = 0; w <= maxWeekDisp; w += tickInterval) ticks.push(w);
          if (ticks[ticks.length - 1] !== maxWeekDisp) ticks.push(maxWeekDisp);

          // Group tasks by discipline, sort groups by latest finish
          const groups = {};
          forecast.taskBars.forEach(t => {
            const g = t.discipline || "Unassigned";
            if (!groups[g]) groups[g] = [];
            groups[g].push(t);
          });
          Object.values(groups).forEach(arr => arr.sort((a, b) => a.adjEndDay - b.adjEndDay));

          const origDiscNames = disciplines.map(d => d.name);
          const discOrder = Object.keys(groups)
            .sort((a, b) => {
              const maxA = Math.max(...groups[a].map(t => t.adjEndDay));
              const maxB = Math.max(...groups[b].map(t => t.adjEndDay));
              return maxA - maxB;
            });

          // Build flat row list + task row index map for arrows
          const rows = [];
          const taskRowMap = {};
          discOrder.forEach(dName => {
            const tasks = groups[dName];
            const di = origDiscNames.indexOf(dName);
            const color = DISCIPLINE_COLORS[di >= 0 ? di % DISCIPLINE_COLORS.length : 0];
            const isCollapsed = taskGanttCollapsed[dName];
            const totalHrs = tasks.reduce((s, t) => s + t.hours, 0);
            const maxBaseEnd = Math.max(...tasks.map(t => t.baseEndDay));
            const maxAdjEnd = Math.max(...tasks.map(t => t.adjEndDay));
            rows.push({ type: "group", name: dName, color, count: tasks.length, totalHrs, maxBaseEnd, maxAdjEnd, collapsed: isCollapsed });
            if (!isCollapsed) {
              tasks.forEach(t => {
                taskRowMap[t.id] = rows.length;
                rows.push({ type: "task", ...t, color });
              });
            }
          });

          // Build logic link arrows using adjusted CPM positions
          const taskBarMap = {};
          forecast.taskBars.forEach(t => { taskBarMap[t.id] = t; });
          const rels = xerSchedule ? (xerSchedule.relationships || []) : [];
          const arrows = rels.filter(r => taskRowMap[r.fromId] !== undefined && taskRowMap[r.toId] !== undefined).map(r => {
            const from = taskBarMap[r.fromId];
            const to = taskBarMap[r.toId];
            if (!from || !to) return null;
            const t = r.type || 'PR_FS';
            let fromDay, toDay;
            if (t === 'PR_FS' || t === 'FS') { fromDay = from.adjEndDay; toDay = to.adjStartDay; }
            else if (t === 'PR_FF' || t === 'FF') { fromDay = from.adjEndDay; toDay = to.adjEndDay; }
            else if (t === 'PR_SS' || t === 'SS') { fromDay = from.adjStartDay; toDay = to.adjStartDay; }
            else if (t === 'PR_SF' || t === 'SF') { fromDay = from.adjStartDay; toDay = to.adjEndDay; }
            else { fromDay = from.adjEndDay; toDay = to.adjStartDay; }
            return {
              fromRow: taskRowMap[r.fromId], toRow: taskRowMap[r.toId],
              fromPct: (fromDay / maxDay) * 100, toPct: (toDay / maxDay) * 100,
              isCritical: from.isCritical && to.isCritical,
            };
          }).filter(Boolean);

          // Compute per-row y offsets (groups are taller than tasks)
          const rowYOffsets = [];
          let runningY = 0;
          rows.forEach(r => {
            rowYOffsets.push(runningY);
            runningY += r.type === "group" ? groupRowHeight : rowHeight;
          });
          const chartH = runningY + 4;

          return (
            <div style={{ overflowX: "auto", position: "relative" }}>
              {/* Tooltip */}
              {taskGanttTooltip && (() => {
                const r = taskGanttTooltip.row;
                if (r.type === "group") return null;
                const baseDur = Math.round(r.baseEndDay - r.baseStartDay);
                const adjDur = Math.round(r.adjEndDay - r.adjStartDay);
                const finishImprove = Math.round(r.baseEndDay - r.adjEndDay);
                const inOtZoneTT = otMode !== "none" && otStartDay >= 0 && r.adjEndDay > otStartDay;
                const inOt = inOtZoneTT && (otScope === "zone" || r.isCritical || r.isCompressed);
                const startShiftD = Math.round(r.baseStartDay - r.adjStartDay);
                const durCompD = Math.max(0, baseDur - adjDur);
                return (
                  <div style={{
                    position: "fixed",
                    left: taskGanttTooltip.x + 16, top: taskGanttTooltip.y + 16,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: 6, padding: "10px 14px", fontSize: 11, color: COLORS.text,
                    zIndex: 100, pointerEvents: "none", boxShadow: `0 4px 16px ${COLORS.bg}cc`,
                    minWidth: 260, lineHeight: 1.7,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: r.color }}>{r.name}</div>
                    <div style={{ color: COLORS.textDim, fontSize: 10, marginBottom: 4 }}>{r.discipline} · {r.hours.toLocaleString()} hrs{r.isCritical ? " · Critical Path" : ""}</div>
                    <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
                      <tbody>
                        <tr>
                          <td style={{ color: COLORS.textDim, paddingRight: 10, verticalAlign: "top" }}>Base:</td>
                          <td>{baseDur}d <span style={{ color: COLORS.textDim, fontSize: 10 }}>Wk {(r.baseStartDay/7).toFixed(1)}–{(r.baseEndDay/7).toFixed(1)}</span></td>
                        </tr>
                        <tr>
                          <td style={{ color: COLORS.textDim, paddingRight: 10, verticalAlign: "top" }}>Adj:</td>
                          <td>{adjDur}d <span style={{ color: COLORS.textDim, fontSize: 10 }}>Wk {(r.adjStartDay/7).toFixed(1)}–{(r.adjEndDay/7).toFixed(1)}</span></td>
                        </tr>
                      </tbody>
                    </table>
                    {finishImprove !== 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${COLORS.border}44` }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: finishImprove > 0 ? COLORS.green : COLORS.red }}>
                          Finish: {finishImprove > 0 ? `${finishImprove}d earlier` : `${-finishImprove}d later`}
                        </div>
                        {finishImprove > 0 && (startShiftD > 0 || durCompD > 0) && (
                          <div style={{ display: "flex", gap: 12, marginTop: 3, fontSize: 10 }}>
                            {startShiftD > 0 && (
                              <span style={{ color: COLORS.blue, fontWeight: 600 }}>
                                ↤ Logic pull: {Math.min(startShiftD, finishImprove)}d
                              </span>
                            )}
                            {durCompD > 0 && (
                              <span style={{ color: COLORS.green, fontWeight: 600 }}>
                                ↥ Compressed: {durCompD}d
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {inOt && (
                      <div style={{ color: COLORS.orange, fontWeight: 600, marginTop: 4, fontSize: 10 }}>
                        OT: {otMode === "sat" ? "6-day week (Sat)" : "7-day week (Sat+Sun)"}{durCompD > 0 ? ` · ${durCompD}d saved via extra work days` : " · In OT zone"}
                      </div>
                    )}
                    {r.totalFloat !== undefined && (
                      <div style={{ color: r.totalFloat <= 0 ? COLORS.red : r.totalFloat <= 7 ? COLORS.orange : COLORS.textDim, fontWeight: 600, marginTop: 4, fontSize: 10 }}>
                        Float: {Math.round(r.totalFloat)}d{r.totalFloat <= 0 ? " (Critical)" : ""}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Time axis */}
              <div style={{ display: "flex", marginBottom: 2 }}>
                <div style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0 }} />
                <div style={{ flex: 1, position: "relative", height: 22 }}>
                  {ticks.map((w) => (
                    <div key={w} style={{
                      position: "absolute", left: `${(w / maxWeekDisp) * 100}%`,
                      transform: "translateX(-50%)", fontSize: 9, color: COLORS.textMuted,
                      whiteSpace: "nowrap", textAlign: "center", lineHeight: 1,
                    }}>
                      <div>Wk {w}</div>
                      <div style={{ fontSize: 8, color: COLORS.textMuted + "88", marginTop: 1 }}>{getWeekDate(w)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ width: rightPad, minWidth: rightPad, flexShrink: 0 }} />
              </div>

              {/* Rows with logic link arrows */}
              <div style={{ position: "relative", minWidth: 600 }}>
                {/* SVG overlay for logic links */}
                <svg style={{ position: "absolute", top: 0, left: labelWidth, width: `calc(100% - ${labelWidth + rightPad}px)`, height: chartH, pointerEvents: "none", zIndex: 5, overflow: "visible" }} viewBox={`0 0 1000 ${chartH}`} preserveAspectRatio="none">
                  <defs>
                    <marker id="tah" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><path d="M0,0 L6,2 L0,4 Z" fill="#9ca3af" /></marker>
                    <marker id="tahc" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><path d="M0,0 L6,2 L0,4 Z" fill="#dc2626" /></marker>
                  </defs>
                  {arrows.map((a, i) => {
                    const x1 = a.fromPct * 10;
                    const x2 = a.toPct * 10;
                    const fromIsTask = rows[a.fromRow]?.type !== "group";
                    const toIsTask = rows[a.toRow]?.type !== "group";
                    const fromH = fromIsTask ? rowHeight : groupRowHeight;
                    const toH = toIsTask ? rowHeight : groupRowHeight;
                    // Arrows connect to center of adjusted bar (top 3px + 13px/2 = 9.5px) not row center
                    const adjBarCenter = 3 + 13 / 2;
                    const y1 = (rowYOffsets[a.fromRow] || 0) + (fromIsTask ? adjBarCenter : fromH / 2);
                    const y2 = (rowYOffsets[a.toRow] || 0) + (toIsTask ? adjBarCenter : toH / 2);
                    const color = a.isCritical ? '#dc2626' : '#9ca3af';
                    const marker = a.isCritical ? 'url(#tahc)' : 'url(#tah)';
                    if (Math.abs(y1 - y2) < 2) {
                      return <path key={i} d={`M${x1},${y1} L${x2},${y2}`} fill="none" stroke={color} strokeWidth={a.isCritical ? 1.2 : 0.7} opacity={0.5} markerEnd={marker} />;
                    }
                    const dropX = Math.min(x1 + 12, 998);
                    const enterX = Math.max(x2 - 12, 2);
                    const midY = y1 + (y2 - y1) * 0.5;
                    const path = `M${x1},${y1} L${dropX},${y1} L${dropX},${midY} L${enterX},${midY} L${enterX},${y2} L${x2},${y2}`;
                    return <path key={i} d={path} fill="none" stroke={color} strokeWidth={a.isCritical ? 1.2 : 0.7} opacity={0.5} markerEnd={marker} />;
                  })}
                </svg>

              {rows.map((row, idx) => {
                if (row.type === "group") {
                  const groupDelta = Math.round(row.maxBaseEnd - row.maxAdjEnd);
                  return (
                    <div key={`g-${row.name}`} style={{
                      display: "flex", alignItems: "center", height: groupRowHeight,
                      background: `${row.color}10`, borderBottom: `1px solid ${COLORS.border}44`,
                      cursor: "pointer",
                    }}
                      onClick={() => setTaskGanttCollapsed(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                    >
                      <div style={{
                        width: labelWidth, minWidth: labelWidth, flexShrink: 0, paddingLeft: 8,
                        fontSize: 12, fontWeight: 700, color: COLORS.text,
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ fontSize: 9, color: COLORS.textDim, transform: row.collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: row.color, flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                        <span style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 400 }}>({row.count})</span>
                      </div>
                      <div style={{ flex: 1 }} />
                      <div style={{ width: rightPad, minWidth: rightPad, flexShrink: 0, textAlign: "right", paddingRight: 8, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <span style={{ color: COLORS.text, fontWeight: 600 }}>{row.totalHrs.toLocaleString()} hrs</span>
                        {groupDelta !== 0 && (
                          <span style={{
                            color: groupDelta > 0 ? COLORS.green : COLORS.red, fontWeight: 700, fontSize: 10,
                            background: `${groupDelta > 0 ? COLORS.green : COLORS.red}12`,
                            padding: "1px 5px", borderRadius: 3,
                            border: `1px solid ${groupDelta > 0 ? COLORS.green : COLORS.red}22`,
                          }}>
                            {groupDelta > 0 ? `▲${groupDelta}d` : `▼${-groupDelta}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }

                // Task row — P6-style with baseline bar underneath
                const baseLeftPct = (row.baseStartDay / maxDay) * 100;
                const baseWidthPct = (Math.max(1, row.baseEndDay - row.baseStartDay) / maxDay) * 100;
                const adjLeftPct = (row.adjStartDay / maxDay) * 100;
                const adjWidthPct = (Math.max(1, row.adjEndDay - row.adjStartDay) / maxDay) * 100;
                const baseDur = Math.round(row.baseEndDay - row.baseStartDay);
                const adjDur = Math.round(row.adjEndDay - row.adjStartDay);
                const finishDelta = Math.round(row.baseEndDay - row.adjEndDay);
                const startDelta = Math.round(row.baseStartDay - row.adjStartDay);
                const durationDelta = baseDur - adjDur;
                const inOtZone = otStartDay >= 0 && row.adjEndDay > otStartDay && row.adjStartDay < maxDay;
                // In task-specific OT mode, only critical/compressed tasks actually work OT
                const taskUsesOt = otMode !== "none" && inOtZone
                  && (otScope === "zone" || row.isCritical || row.isCompressed);

                // Bar vertical layout: adjusted bar upper, baseline bar lower
                const adjBarTop = 3;
                const adjBarH = 13;
                const baseBarTop = adjBarTop + adjBarH + 2;
                const baseBarH = 6;

                return (
                  <div key={`t-${row.id}`} style={{
                    display: "flex", alignItems: "center", height: rowHeight,
                    borderBottom: `1px solid ${COLORS.border}11`,
                    background: idx % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22`,
                  }}>
                    {/* Label */}
                    <div style={{
                      width: labelWidth, minWidth: labelWidth, flexShrink: 0,
                      paddingLeft: 28, fontSize: 11, color: COLORS.text,
                      display: "flex", alignItems: "center", gap: 6, overflow: "hidden",
                    }}>
                      {row.isCritical && <span style={{ fontSize: 8, color: COLORS.red, fontWeight: 700 }}>●</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                    </div>

                    {/* Bar area */}
                    <div
                      style={{ flex: 1, position: "relative", height: "100%" }}
                      onMouseEnter={(e) => setTaskGanttTooltip({ row, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setTaskGanttTooltip(prev => prev ? { ...prev, row, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setTaskGanttTooltip(null)}
                    >
                      {/* Grid lines */}
                      {ticks.map((w) => (
                        <div key={w} style={{
                          position: "absolute", left: `${(w / maxWeekDisp) * 100}%`,
                          top: 0, bottom: 0, width: 1, background: `${COLORS.border}33`,
                        }} />
                      ))}

                      {/* OT zone background */}
                      {otStartDay >= 0 && (
                        <div style={{
                          position: "absolute",
                          left: `${(otStartDay / maxDay) * 100}%`,
                          right: 0, top: 0, bottom: 0,
                          background: `${COLORS.orange}06`,
                          pointerEvents: "none",
                        }} />
                      )}

                      {/* ── Baseline bar (P6-style, underneath) ── */}
                      {weekOffset !== 0 && (
                        <div style={{
                          position: "absolute",
                          left: `${baseLeftPct}%`,
                          width: `${baseWidthPct}%`,
                          top: baseBarTop,
                          height: baseBarH,
                          background: `${COLORS.textMuted}30`,
                          borderRadius: 1.5, zIndex: 0,
                          border: `1px solid ${COLORS.textMuted}25`,
                          transition: "left 0.3s, width 0.3s",
                        }} />
                      )}

                      {/* ── Adjusted bar (main, on top) ── */}
                      <div style={{
                        position: "absolute",
                        left: `${adjLeftPct}%`,
                        width: `${Math.max(0.3, adjWidthPct)}%`,
                        top: adjBarTop,
                        height: adjBarH,
                        background: `linear-gradient(90deg, ${row.color}cc, ${row.color}99)`,
                        borderRadius: 2, zIndex: 1,
                        boxShadow: row.isCritical ? `0 0 4px ${COLORS.red}44` : `0 1px 3px ${row.color}22`,
                        border: row.isCritical ? `1px solid ${COLORS.red}44` : "none",
                        transition: "left 0.3s, width 0.3s",
                      }} />

                      {/* OT hatch overlay on adjusted bar */}
                      {taskUsesOt && (() => {
                        const otClipStart = inOtZone ? Math.max(otStartDay, row.adjStartDay) : row.adjStartDay;
                        const otClipEnd = row.adjEndDay;
                        if (otClipStart >= otClipEnd) return null;
                        const otLeftPct2 = (otClipStart / maxDay) * 100;
                        const otWidthPct2 = ((otClipEnd - otClipStart) / maxDay) * 100;
                        return (
                          <div style={{
                            position: "absolute",
                            left: `${otLeftPct2}%`, width: `${otWidthPct2}%`,
                            top: adjBarTop, height: adjBarH,
                            background: `repeating-linear-gradient(45deg, #000000aa, #000000aa 3px, ${row.color}88 3px, ${row.color}88 6px)`,
                            borderRadius: 2, zIndex: 2,
                            transition: "left 0.3s, width 0.3s",
                            pointerEvents: "none",
                          }} />
                        );
                      })()}
                    </div>

                    {/* Right info */}
                    <div style={{
                      width: rightPad, minWidth: rightPad, flexShrink: 0,
                      textAlign: "right", paddingRight: 8, fontSize: 10,
                      display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 0,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: COLORS.textDim }}>{adjDur}d</span>
                        {taskUsesOt && <span style={{ color: COLORS.orange, fontWeight: 600, fontSize: 7 }} title="OT utilized">⬤</span>}
                      </div>
                      {finishDelta !== 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9 }}>
                          {(() => {
                            if (finishDelta > 0) {
                              // Finish improved — decompose into logic pull + compression
                              const logicPull = Math.max(0, Math.min(startDelta, finishDelta));
                              const compress = finishDelta - logicPull;
                              return (<>
                                {logicPull > 0 && (
                                  <span style={{ fontWeight: 700, color: COLORS.blue }} title="Logic pull (predecessors finished earlier)">
                                    ↤{logicPull}
                                  </span>
                                )}
                                {compress > 0 && (
                                  <span style={{ fontWeight: 700, color: COLORS.green }} title="Compression (OT extra work days)">
                                    ↥{compress}
                                  </span>
                                )}
                              </>);
                            } else {
                              return (
                                <span style={{ fontWeight: 700, color: COLORS.red }}>
                                  +{-finishDelta}d
                                </span>
                              );
                            }
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                );

              })}
              </div>

              {/* Summary row */}
              <div style={{
                display: "flex", alignItems: "center", height: 32,
                borderTop: `2px solid ${COLORS.border}`, marginTop: 2,
              }}>
                <div style={{
                  width: labelWidth, minWidth: labelWidth, flexShrink: 0, paddingLeft: 8,
                  fontSize: 11, fontWeight: 700, color: COLORS.accent, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  Project Duration
                </div>
                <div style={{ flex: 1, position: "relative", height: "100%" }}>
                  <div style={{
                    position: "absolute", left: 0, width: `${(Math.max(...forecast.taskBars.map(t => t.adjEndDay)) / maxDay) * 100}%`,
                    top: "50%", transform: "translateY(-50%)", height: 6,
                    background: `${COLORS.accent}44`, borderRadius: 3,
                  }} />
                </div>
                <div style={{
                  width: rightPad, minWidth: rightPad, flexShrink: 0,
                  textAlign: "right", paddingRight: 8,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.accent }}>
                    {forecast.effectiveWeeks} wks
                  </span>
                  {weekOffset !== 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: weekOffset < 0 ? COLORS.green : COLORS.red, marginLeft: 4 }}>
                      ({weekOffset > 0 ? "+" : ""}{weekOffset} wks)
                    </span>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, marginTop: 8, paddingLeft: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                  <span style={{ fontSize: 8, color: COLORS.red, fontWeight: 700 }}>●</span> Critical Path
                </div>
                {weekOffset !== 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <div style={{ width: 20, height: 6, background: COLORS.blue, borderRadius: 1.5, opacity: 0.7 }} />
                      <div style={{ width: 24, height: 4, background: `${COLORS.textMuted}35`, borderRadius: 1, border: `1px solid ${COLORS.textMuted}25` }} />
                    </div>
                    Baseline Bar
                  </div>
                )}
                {weekOffset !== 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.blue }}>↤</span> Logic Pull
                  </div>
                )}
                {weekOffset < 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.green }}>↥</span> Compressed
                  </div>
                )}
                {forecast.numOtWeeks > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ width: 14, height: 8, background: `${COLORS.blue}88`, borderRadius: 1, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(45deg, #000000aa, #000000aa 2px, ${COLORS.blue}88 2px, ${COLORS.blue}88 5px)` }} />
                    </div>
                    OT Utilized
                  </div>
                )}
                {otStartDay >= 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <div style={{ width: 14, height: 8, background: `${COLORS.orange}12`, borderRadius: 1 }} />
                    OT Zone (Wk {otStartWeek}+)
                  </div>
                )}
                {arrows.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <svg width="14" height="8" viewBox="0 0 14 8"><line x1="0" y1="4" x2="12" y2="4" stroke="#9ca3af" strokeWidth="1" /><polygon points="10,2 14,4 10,6" fill="#9ca3af" /></svg>
                    Logic Link
                  </div>
                )}
                {arrows.some(a => a.isCritical) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <svg width="14" height="8" viewBox="0 0 14 8"><line x1="0" y1="4" x2="12" y2="4" stroke="#dc2626" strokeWidth="1.2" /><polygon points="10,2 14,4 10,6" fill="#dc2626" /></svg>
                    Critical Link
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      )}

      {/* Weekly Cost Breakdown */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={styles.cardTitle}>Weekly Cost Distribution — Adjusted</div>
          <button style={styles.btn(showByDiscipline ? "primary" : "default")} onClick={() => setShowByDiscipline(!showByDiscipline)}>
            {showByDiscipline ? "By Cost Type" : "By Discipline"}
          </button>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={forecast.weeklyData}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="week" stroke={COLORS.textMuted} tick={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }} formatter={(v) => formatCurrency(v)} />
            {showByDiscipline
              ? disciplines.map((d, i) => (
                  <Area key={d.id} type="monotone" dataKey={`adj_${d.id}`} name={d.name} stackId="1" stroke={DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length]} fill={DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length]} fillOpacity={0.65} />
                ))
              : [
                  <Area key="direct" type="monotone" dataKey="adjDirect" name="Direct Cost" stackId="1" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.6} />,
                  <Area key="time" type="monotone" dataKey="adjTime" name="Time-Based Cost" stackId="1" stroke={COLORS.accent} fill={COLORS.accent} fillOpacity={0.6} />,
                ]
            }
            <ReferenceLine x={baseWeeks} stroke={COLORS.textMuted} strokeDasharray="5 5" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown Tables */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...styles.card, flex: "1 1 400px" }}>
          <div style={styles.cardTitle}>Direct Cost by Discipline</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Discipline</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Total Hours</th>
                <th style={{ ...styles.th, textAlign: "right" }}>$/Hr</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Base Cost</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Adjusted Cost</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {disciplines.map((d, i) => {
                const bd = forecast.weeklyDirectByDisc[d.id];
                if (!bd) return null;
                const delta = bd.adjCost - bd.baseCost;
                return (
                  <tr key={d.id}>
                    <td style={styles.td}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length], marginRight: 8 }} />
                      {d.name}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{formatNumber(bd.totalAdjHours)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>${d.rate.toFixed(2)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{formatCurrency(bd.baseCost)}</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>{formatCurrency(bd.adjCost)}</td>
                    <td style={{ ...styles.td, textAlign: "right", color: delta === 0 ? COLORS.textMuted : delta > 0 ? COLORS.red : COLORS.green }}>
                      {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${formatCurrency(delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                <td style={{ ...styles.td, fontWeight: 700 }}>Total Direct</td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatNumber(Object.values(forecast.weeklyDirectByDisc).reduce((s, d) => s + d.totalAdjHours, 0))}</td>
                <td style={styles.td}></td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatCurrency(forecast.totalBaseDirectCost)}</td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatCurrency(forecast.totalAdjDirectCost)}</td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: forecast.totalAdjDirectCost - forecast.totalBaseDirectCost === 0 ? COLORS.textMuted : forecast.totalAdjDirectCost > forecast.totalBaseDirectCost ? COLORS.red : COLORS.green }}>
                  {forecast.totalAdjDirectCost - forecast.totalBaseDirectCost === 0 ? "—" : formatCurrency(forecast.totalAdjDirectCost - forecast.totalBaseDirectCost)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ ...styles.card, flex: "1 1 400px" }}>
          <div style={styles.cardTitle}>Time-Based Cost Breakdown</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Description</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Rate</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Base Cost</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Adjusted</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {timeCostBreakdown.map((t) => (
                <tr key={t.id}>
                  <td style={styles.td}>{t.name}</td>
                  <td style={{ ...styles.td, textAlign: "right", color: COLORS.textDim }}>{formatCurrency(t.rate)}/{t.basis === "weekly" ? "wk" : "mo"}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>{formatCurrency(t.baseCost)}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>{formatCurrency(t.adjCost)}</td>
                  <td style={{ ...styles.td, textAlign: "right", color: t.delta === 0 ? COLORS.textMuted : t.delta > 0 ? COLORS.red : COLORS.green }}>
                    {t.delta === 0 ? "—" : `${t.delta > 0 ? "+" : ""}${formatCurrency(t.delta)}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                <td style={{ ...styles.td, fontWeight: 700 }}>Total Time-Based</td>
                <td style={styles.td}></td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatCurrency(forecast.baseTimeCost)}</td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatCurrency(forecast.adjTimeCost)}</td>
                <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: forecast.adjTimeCost - forecast.baseTimeCost === 0 ? COLORS.textMuted : COLORS.red }}>
                  {forecast.adjTimeCost - forecast.baseTimeCost === 0 ? "—" : `+${formatCurrency(forecast.adjTimeCost - forecast.baseTimeCost)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Weekly rate callout */}
      <div style={{ ...styles.card, background: `linear-gradient(135deg, ${COLORS.surfaceAlt}, ${COLORS.surface})`, borderColor: COLORS.accentDim }}>
        <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Time-Based Burn Rate</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.accent }}>{formatCurrency(forecast.weeklyTimeCostRate)}<span style={{ fontSize: 13, color: COLORS.textDim }}>/week</span></div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Cost per Week of Extension</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.red }}>{formatCurrency(forecast.weeklyTimeCostRate)}<span style={{ fontSize: 13, color: COLORS.textDim }}>/week</span></div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Monthly Equivalent</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: COLORS.red }}>{formatCurrency(forecast.weeklyTimeCostRate * 4.33)}<span style={{ fontSize: 13, color: COLORS.textDim }}>/month</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DataTab({ disciplines, hoursData, timeCosts, timeCostData, baseWeeks, startDate }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);
  const weeksArray = Array.from({ length: baseWeeks }, (_, i) => i);
  const hoursScrollRef = useRef(null);
  const costScrollRef = useRef(null);
  const timeScrollRef = useRef(null);
  const isSyncing = useRef(false);

  const syncAllScrolls = useCallback((source) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    const sl = source.current.scrollLeft;
    [hoursScrollRef, costScrollRef, timeScrollRef].forEach((r) => {
      if (r !== source && r.current) r.current.scrollLeft = sl;
    });
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const tableData = useMemo(() => {
    return weeksArray.map((w) => {
      const weekDate = new Date(startDate);
      weekDate.setDate(weekDate.getDate() + w * 7); snapToSunday(weekDate);
      const dateStr = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

      const row = { week: w + 1, date: dateStr };
      let totalHours = 0;
      let totalCost = 0;

      disciplines.forEach((d) => {
        const hrs = (hoursData[d.id] || [])[w] || 0;
        const cost = hrs * d.rate;
        row[`hrs_${d.id}`] = hrs;
        row[`cost_${d.id}`] = cost;
        totalHours += hrs;
        totalCost += cost;
      });

      // Sum per-week time costs from imported data
      const weekTimeCost = timeCosts.reduce((s, t) => {
        return s + ((timeCostData[t.id] || [])[w] || 0);
      }, 0);

      // Per time-cost item values for the time cost table
      timeCosts.forEach((t) => {
        row[`tc_${t.id}`] = (timeCostData[t.id] || [])[w] || 0;
      });

      row.totalHours = totalHours;
      row.totalCost = totalCost;
      row.timeCost = weekTimeCost;
      row.grandTotalCost = totalCost + weekTimeCost;
      return row;
    });
  }, [disciplines, hoursData, timeCosts, timeCostData, baseWeeks, startDate]);

  const grandTotals = useMemo(() => {
    const totals = { totalHours: 0, totalCost: 0, timeCost: 0, grandTotalCost: 0 };
    disciplines.forEach((d) => { totals[`hrs_${d.id}`] = 0; totals[`cost_${d.id}`] = 0; });
    timeCosts.forEach((t) => { totals[`tc_${t.id}`] = 0; });
    tableData.forEach((row) => {
      disciplines.forEach((d) => {
        totals[`hrs_${d.id}`] += row[`hrs_${d.id}`];
        totals[`cost_${d.id}`] += row[`cost_${d.id}`];
      });
      timeCosts.forEach((t) => {
        totals[`tc_${t.id}`] += row[`tc_${t.id}`];
      });
      totals.totalHours += row.totalHours;
      totals.totalCost += row.totalCost;
      totals.timeCost += row.timeCost;
      totals.grandTotalCost += row.grandTotalCost;
    });
    return totals;
  }, [tableData, disciplines, timeCosts]);

  const cellNum = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const renderTable = (mode, scrollRef) => {
    const isHours = mode === "hours";
    const weeksArr = Array.from({ length: baseWeeks }, (_, i) => i);

    // Build row definitions
    const rows = disciplines.map((d, i) => ({
      key: d.id,
      label: d.name,
      color: DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length],
      values: weeksArr.map((w) => isHours ? (tableData[w]?.[`hrs_${d.id}`] || 0) : (tableData[w]?.[`cost_${d.id}`] || 0)),
      total: isHours ? grandTotals[`hrs_${d.id}`] : grandTotals[`cost_${d.id}`],
    }));

    if (!isHours) {
      rows.push({
        key: "direct_total",
        label: "Direct Total",
        color: COLORS.blue,
        isSummary: true,
        values: weeksArr.map((w) => tableData[w]?.totalCost || 0),
        total: grandTotals.totalCost,
      });
      rows.push({
        key: "time_based",
        label: "Time-Based",
        color: COLORS.accent,
        values: weeksArr.map((w) => tableData[w]?.timeCost || 0),
        total: grandTotals.timeCost,
      });
      rows.push({
        key: "grand_total",
        label: "Grand Total",
        color: COLORS.text,
        isSummary: true,
        isGrand: true,
        values: weeksArr.map((w) => tableData[w]?.grandTotalCost || 0),
        total: grandTotals.grandTotalCost,
      });
    }

    // Footer row: column totals (hours mode only — cost mode has inline totals)
    const colTotals = isHours
      ? weeksArr.map((w) => disciplines.reduce((s, d) => s + (tableData[w]?.[`hrs_${d.id}`] || 0), 0))
      : null;

    return (
      <div ref={scrollRef} onScroll={() => syncAllScrolls(scrollRef)} style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 4 }}>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead>
            <tr style={{ background: COLORS.surfaceAlt }}>
              <th style={{ ...styles.th, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 160, top: 0 }}>
                {isHours ? "Discipline" : "Category"}
              </th>
              {weeksArr.map((w) => {
                const row = tableData[w];
                return (
                  <th key={w} style={{ ...styles.th, textAlign: "center", minWidth: isHours ? 72 : 88, padding: "6px 4px", top: 0, zIndex: 2, background: COLORS.surfaceAlt }}>
                    <div style={{ fontWeight: 700 }}>Wk {w + 1}</div>
                    <div style={{ fontSize: 9, fontWeight: 400, color: COLORS.textMuted, marginTop: 1 }}>{row?.date || ""}</div>
                  </th>
                );
              })}
              <th style={{ ...styles.th, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 90, textAlign: "right", top: 0 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={row.key}
                style={{
                  background: row.isGrand ? `${COLORS.surfaceAlt}88` : row.isSummary ? `${COLORS.surfaceAlt}44` : ri % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22`,
                  borderTop: row.isSummary ? `1px solid ${COLORS.border}` : undefined,
                }}
              >
                <td style={{
                  ...styles.td,
                  position: "sticky",
                  left: 0,
                  background: row.isGrand ? COLORS.surfaceAlt : row.isSummary ? COLORS.surfaceAlt : ri % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt,
                  zIndex: 2,
                  fontWeight: row.isSummary ? 700 : 600,
                  whiteSpace: "nowrap",
                  color: row.isSummary ? row.color : COLORS.text,
                }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: row.color, marginRight: 8, verticalAlign: "middle" }} />
                  {row.label}
                </td>
                {row.values.map((val, wi) => (
                  <td key={wi} style={{
                    ...styles.td,
                    ...cellNum,
                    color: val > 0 ? (row.isSummary ? row.color : COLORS.text) : COLORS.textMuted + "44",
                    fontWeight: row.isSummary ? 700 : 400,
                  }}>
                    {isHours
                      ? (val > 0 ? formatNumber(val) : "—")
                      : (val > 0 ? formatCurrency(val) : "—")
                    }
                  </td>
                ))}
                <td style={{
                  ...styles.td,
                  ...cellNum,
                  position: "sticky",
                  right: 0,
                  background: row.isGrand ? COLORS.surfaceAlt : row.isSummary ? COLORS.surfaceAlt : ri % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt,
                  zIndex: 2,
                  fontWeight: 700,
                  color: row.isSummary ? row.color : COLORS.text,
                  fontSize: row.isGrand ? 14 : 12,
                }}>
                  {isHours ? formatNumber(row.total) : formatCurrency(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
          {isHours && colTotals && (
            <tfoot>
              <tr style={{ background: COLORS.surfaceAlt, borderTop: `2px solid ${COLORS.accent}44` }}>
                <td style={{ ...styles.td, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: COLORS.accent }}>Total</td>
                {colTotals.map((ct, wi) => (
                  <td key={wi} style={{ ...styles.td, ...cellNum, fontWeight: 600, color: ct > 0 ? COLORS.text : COLORS.textMuted }}>
                    {formatNumber(ct)}
                  </td>
                ))}
                <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, color: COLORS.accent }}>
                  {formatNumber(grandTotals.totalHours)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  };

  const discSummary = disciplines.map((d, i) => ({
    name: d.name,
    color: DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length],
    totalHours: grandTotals[`hrs_${d.id}`],
    rate: d.rate,
    totalCost: grandTotals[`cost_${d.id}`],
  }));

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {discSummary.map((d) => (
          <div key={d.name} style={{ ...styles.metric(d.color), flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>{d.name}</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatNumber(d.totalHours)} <span style={{ fontSize: 12, color: COLORS.textDim }}>hrs</span></div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>${d.rate}/hr → {formatCurrency(d.totalCost)}</div>
          </div>
        ))}
        <div style={{ ...styles.metric(COLORS.accent), flex: "1 1 160px" }}>
          <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Time-Based (Total)</div>
          <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatCurrency(grandTotals.timeCost)}</div>
          <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>{baseWeeks} weeks</div>
        </div>
      </div>

      {/* Hours section */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: COLORS.blue, marginRight: 10, verticalAlign: "middle" }} />
            Weekly Hours by Discipline
          </div>
          <div style={{ fontSize: 12, color: COLORS.textDim }}>
            {baseWeeks} weeks · {disciplines.length} disciplines · {formatNumber(grandTotals.totalHours)} total hours
          </div>
        </div>
        {renderTable("hours", hoursScrollRef)}
      </div>

      {/* Cost section */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: COLORS.accent, marginRight: 10, verticalAlign: "middle" }} />
            Weekly Cost by Discipline + Time-Based
          </div>
          <div style={{ fontSize: 12, color: COLORS.textDim }}>
            Hours × $/Hr rate · Time-based costs at weekly burn rate · {formatCurrency(grandTotals.grandTotalCost)} total
          </div>
        </div>
        {renderTable("cost", costScrollRef)}
      </div>

      {/* Time-Based Costs section */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={styles.cardTitle}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: COLORS.accent, marginRight: 10, verticalAlign: "middle" }} />
            Weekly Time-Based Costs
          </div>
          <div style={{ fontSize: 12, color: COLORS.textDim }}>
            {timeCosts.length} cost items · {baseWeeks} weeks · {formatCurrency(grandTotals.timeCost)} total
          </div>
        </div>
        {(() => {
          const weeksArr = Array.from({ length: baseWeeks }, (_, i) => i);
          const TIME_COLORS = ["#f59e0b", "#fb923c", "#fbbf24", "#f97316", "#eab308"];

          const rows = timeCosts.map((t, i) => ({
            key: t.id,
            label: t.name,
            color: TIME_COLORS[i % TIME_COLORS.length],
            values: weeksArr.map((w) => (timeCostData[t.id] || [])[w] || 0),
            total: grandTotals[`tc_${t.id}`] || 0,
            basis: t.basis,
          }));

          const totalRow = {
            key: "total",
            label: "Total Time-Based",
            color: COLORS.accent,
            isSummary: true,
            values: weeksArr.map((w) => timeCosts.reduce((s, t) => s + ((timeCostData[t.id] || [])[w] || 0), 0)),
            total: grandTotals.timeCost,
          };

          return (
            <div ref={timeScrollRef} onScroll={() => syncAllScrolls(timeScrollRef)} style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 4 }}>
              <table style={{ ...styles.table, fontSize: 12 }}>
                <thead>
                  <tr style={{ background: COLORS.surfaceAlt }}>
                    <th style={{ ...styles.th, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 200, top: 0 }}>Cost Item</th>
                    {weeksArr.map((w) => {
                      const row = tableData[w];
                      return (
                        <th key={w} style={{ ...styles.th, textAlign: "center", minWidth: 88, padding: "6px 4px", top: 0, zIndex: 2, background: COLORS.surfaceAlt }}>
                          <div style={{ fontWeight: 700 }}>Wk {w + 1}</div>
                          <div style={{ fontSize: 9, fontWeight: 400, color: COLORS.textMuted, marginTop: 1 }}>{row?.date || ""}</div>
                        </th>
                      );
                    })}
                    <th style={{ ...styles.th, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 100, textAlign: "right", top: 0 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={row.key} style={{ background: ri % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22` }}>
                      <td style={{
                        ...styles.td,
                        position: "sticky",
                        left: 0,
                        background: ri % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt,
                        zIndex: 2,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: row.color, marginRight: 8, verticalAlign: "middle" }} />
                        {row.label}
                        <span style={{ fontSize: 10, color: COLORS.textMuted, marginLeft: 6 }}>({row.basis})</span>
                      </td>
                      {row.values.map((val, wi) => (
                        <td key={wi} style={{ ...styles.td, ...cellNum, color: val > 0 ? COLORS.text : COLORS.textMuted + "44" }}>
                          {val > 0 ? formatCurrency(val) : "—"}
                        </td>
                      ))}
                      <td style={{
                        ...styles.td,
                        ...cellNum,
                        position: "sticky",
                        right: 0,
                        background: ri % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt,
                        zIndex: 2,
                        fontWeight: 700,
                      }}>
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr style={{ background: `${COLORS.surfaceAlt}88`, borderTop: `2px solid ${COLORS.accent}44` }}>
                    <td style={{
                      ...styles.td,
                      position: "sticky",
                      left: 0,
                      background: COLORS.surfaceAlt,
                      zIndex: 2,
                      fontWeight: 700,
                      color: COLORS.accent,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.5px",
                    }}>
                      Total Time-Based
                    </td>
                    {totalRow.values.map((val, wi) => (
                      <td key={wi} style={{ ...styles.td, ...cellNum, fontWeight: 700, color: val > 0 ? COLORS.accent : COLORS.textMuted }}>
                        {formatCurrency(val)}
                      </td>
                    ))}
                    <td style={{
                      ...styles.td,
                      ...cellNum,
                      position: "sticky",
                      right: 0,
                      background: COLORS.surfaceAlt,
                      zIndex: 2,
                      fontWeight: 700,
                      color: COLORS.accent,
                      fontSize: 14,
                    }}>
                      {formatCurrency(totalRow.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function AdjustmentsTab({ disciplines, hoursData, timeCosts, timeCostData, baseWeeks, startDate, weekOffset, otMode, disciplinePFs, setDisciplinePFs, xerSchedule }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);
  const [viewMode, setViewMode] = useState("cost_delta");
  const mainScrollRef = useRef(null);
  const timeScrollRef = useRef(null);
  const isSyncing = useRef(false);

  const syncScroll = useCallback((source, target) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (target.current) target.current.scrollLeft = source.current.scrollLeft;
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const otCap = getOtCapacity(otMode);
  const adjustedWeeks = baseWeeks + weekOffset;
  const minWeeks = getMinWeeks(baseWeeks, otCap, hoursData, xerSchedule);
  const noOtMaxWeeks = Math.round(baseWeeks * 1.5);
  const maxWeeks = otMode !== "none" ? baseWeeks : noOtMaxWeeks;
  const maxCompression = baseWeeks - minWeeks;
  const maxExtension = maxWeeks - baseWeeks;
  const maxW = Math.max(baseWeeks, adjustedWeeks);

  const adjustments = useMemo(() => {
    // CPM task-level compression
    let cpmResult = null;
    const hasCPM = xerSchedule && xerSchedule.activities && xerSchedule.activities.length > 0;
    if (hasCPM && adjustedWeeks !== baseWeeks) {
      cpmResult = compressByCPM(xerSchedule, adjustedWeeks, baseWeeks, otMode);
    }
    const effectiveWeeks = cpmResult ? cpmResult.achievedWeeks : adjustedWeeks;

    let globalPF = 1.0;
    if (effectiveWeeks < baseWeeks) {
      globalPF = getNonLinearPF(effectiveWeeks, baseWeeks, otCap, hoursData);
    } else if (effectiveWeeks > baseWeeks && maxExtension > 0) {
      globalPF = 1.0 + (EXTENSION_PF - 1.0) * ((effectiveWeeks - baseWeeks) / maxExtension);
    }
    const getDiscPF = (discId) => {
      const addlFactor = disciplinePFs[discId];
      if (addlFactor !== undefined && addlFactor !== null) return globalPF * addlFactor;
      return globalPF;
    };
    const cpmAdj = cpmResult ? cpmResult.hoursData : null;
    const stackingPenalties = computeStackingPenalties(hoursData, baseWeeks, effectiveWeeks, cpmAdj);
    const numOtWeeks = getOtWeeks(effectiveWeeks, baseWeeks, otMode);
    const otStartWeek = effectiveWeeks - numOtWeeks;

    const discData = disciplines.map((d) => {
      const origHours = hoursData[d.id] || new Array(baseWeeks).fill(0);
      const adjHours = cpmResult
        ? (cpmResult.hoursData[d.id] || new Array(effectiveWeeks).fill(0))
        : redistributeHours(origHours, baseWeeks, effectiveWeeks);
      const totalOrigHours = origHours.reduce((s, h) => s + h, 0);
      const totalAdjHours = adjHours.reduce((s, h) => s + h, 0);
      const origCostTotal = totalOrigHours * d.rate;
      const discPF = getDiscPF(d.id);
      const adjCostTotal = computeEnhancedCost(origHours, d.rate, d.otRate, otMode, baseWeeks, effectiveWeeks, discPF, stackingPenalties, RISK_BANDS.P50, adjHours);

      const weeks = [];
      for (let w = 0; w < maxW; w++) {
        const bh = w < baseWeeks ? (origHours[w] || 0) : 0;
        const ah = w < effectiveWeeks ? (adjHours[w] || 0) : 0;
        const bc = bh * d.rate;
        const weekRate = getWeekRate(d.rate, d.otRate, otMode, w, effectiveWeeks, baseWeeks);
        // Per-week multiplier with MCAA fatigue + stacking
        let weekMultiplier = 1 / discPF;
        if (otMode !== "none" && w >= otStartWeek && numOtWeeks > 0 && w < effectiveWeeks) {
          const consecutiveOtWeek = w - otStartWeek + 1;
          weekMultiplier *= (1 / getMCAAFatigue(otMode, consecutiveOtWeek));
        }
        if (stackingPenalties && stackingPenalties[w] > 0) {
          weekMultiplier *= (1 + stackingPenalties[w]);
        }
        const ac = ah * weekRate * weekMultiplier;
        weeks.push({
          baseHours: bh, adjHours: ah, deltaHours: ah - bh,
          baseCost: bc, adjCost: ac, deltaCost: ac - bc,
        });
      }
      return {
        id: d.id, name: d.name, rate: d.rate, weeks,
        totalOrigHours, totalAdjHours, deltaHours: totalAdjHours - totalOrigHours,
        origCostTotal, adjCostTotal, deltaCost: adjCostTotal - origCostTotal,
      };
    });

    // Time-based costs
    // When OT is active during acceleration, each work-week takes fewer calendar days,
    // so calendar-based costs (rent, supervision) scale down per work-week.
    const calWeeksAdj = adjustedWeeks;
    const calFactor = adjustedWeeks > 0 ? calWeeksAdj / adjustedWeeks : 1;
    const tcData = timeCosts.map((t) => {
      const origWeekly = Array.from({ length: baseWeeks }, (_, w) => (timeCostData[t.id] || [])[w] || 0);
      const totalOrig = origWeekly.reduce((s, v) => s + v, 0);

      // For extension: extrapolate average weekly rate for extra weeks
      // For compression: truncate; with OT, also scale by calendar factor
      const avgWeekly = totalOrig / baseWeeks;
      const adjWeekly = [];
      for (let w = 0; w < maxW; w++) {
        if (w < Math.min(baseWeeks, adjustedWeeks)) {
          adjWeekly.push(Math.round((origWeekly[w] || 0) * calFactor));
        } else if (w < adjustedWeeks) {
          adjWeekly.push(Math.round(avgWeekly * calFactor));
        } else {
          adjWeekly.push(0);
        }
      }
      const totalAdj = adjWeekly.reduce((s, v) => s + v, 0);

      const weeks = [];
      for (let w = 0; w < maxW; w++) {
        const bv = w < baseWeeks ? (origWeekly[w] || 0) : 0;
        const av = adjWeekly[w] || 0;
        weeks.push({ base: bv, adj: av, delta: av - bv });
      }
      return { id: t.id, name: t.name, weeks, totalOrig, totalAdj, delta: totalAdj - totalOrig };
    });

    const totalOrigDirect = discData.reduce((s, d) => s + d.origCostTotal, 0);
    const totalAdjDirect = discData.reduce((s, d) => s + d.adjCostTotal, 0);
    const totalOrigTime = tcData.reduce((s, t) => s + t.totalOrig, 0);
    const totalAdjTime = tcData.reduce((s, t) => s + t.totalAdj, 0);

    return {
      effectivePF: globalPF, compressionPF: globalPF, discData, tcData,
      totalOrigDirect, totalAdjDirect, deltaDirect: totalAdjDirect - totalOrigDirect,
      totalOrigTime, totalAdjTime, deltaTime: totalAdjTime - totalOrigTime,
      totalOrigEAC: totalOrigDirect + totalOrigTime,
      totalAdjEAC: totalAdjDirect + totalAdjTime,
      deltaEAC: (totalAdjDirect + totalAdjTime) - (totalOrigDirect + totalOrigTime),
      effectiveWeeks,
    };
  }, [disciplines, hoursData, timeCosts, timeCostData, baseWeeks, adjustedWeeks, maxCompression, maxExtension, maxW, otMode, disciplinePFs, xerSchedule]);

  const weeksArr = Array.from({ length: maxW }, (_, i) => i);
  const cellNum = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const deltaColor = (val, mode = "text") => {
    if (val === 0) return mode === "bg" ? "transparent" : COLORS.textMuted + "44";
    const abs = Math.abs(val);
    const maxVal = 500;
    const alpha = Math.min(0.9, 0.15 + (abs / maxVal) * 0.75);
    if (mode === "bg") {
      return val > 0 ? `rgba(239,68,68,${alpha})` : `rgba(34,197,94,${alpha})`;
    }
    // Dynamic text: switch to dark when background is intense enough to clash
    if (mode === "textOnBg") {
      if (alpha > 0.45) return val > 0 ? "#1a0000" : "#001a00";
      return val > 0 ? COLORS.red : COLORS.green;
    }
    return val > 0 ? COLORS.red : COLORS.green;
  };

  const formatDelta = (val, isCurrency = false) => {
    if (val === 0) return "—";
    const prefix = val > 0 ? "+" : "";
    return isCurrency ? `${prefix}${formatCurrency(val)}` : `${prefix}${formatNumber(val)}`;
  };

  const calendarWeeks = adjustedWeeks;
  // Use CPM effective weeks for the displayed end date (may differ from slider target)
  const adjustedEndDate = new Date(startDate);
  adjustedEndDate.setDate(adjustedEndDate.getDate() + Math.round((adjustments.effectiveWeeks || calendarWeeks) * 7) - 1); snapToSunday(adjustedEndDate);
  const baseEndDate = new Date(startDate);
  baseEndDate.setDate(baseEndDate.getDate() + baseWeeks * 7 - 1); snapToSunday(baseEndDate);

  return (
    <div>

      {/* Impact summary */}
      {(weekOffset !== 0 || otMode !== "none") ? (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ ...styles.metric(COLORS.purple), flex: "1 1 140px" }}>
              <div style={styles.metricLabel}>Schedule Change</div>
              <div style={styles.metricValue}>
                {weekOffset === 0 && otMode !== "none"
                  ? `${Math.round(calendarWeeks)} wks`
                  : `${weekOffset > 0 ? "+" : ""}${weekOffset} wks`}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>
                {baseEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → {adjustedEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {weekOffset === 0 && otMode !== "none" && ` (OT calendar)`}
              </div>
            </div>
            <div style={{ ...styles.metric(adjustments.deltaDirect === 0 ? COLORS.textDim : adjustments.deltaDirect > 0 ? COLORS.red : COLORS.green), flex: "1 1 140px" }}>
              <div style={styles.metricLabel}>Direct Cost Δ</div>
              <div style={{ ...styles.metricValue, color: adjustments.deltaDirect === 0 ? COLORS.textDim : adjustments.deltaDirect > 0 ? COLORS.red : COLORS.green }}>
                {formatDelta(adjustments.deltaDirect, true)}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>PF = {adjustments.effectivePF.toFixed(3)} → ×{(1/adjustments.compressionPF).toFixed(4)}</div>
            </div>
            <div style={{ ...styles.metric(adjustments.deltaTime > 0 ? COLORS.red : adjustments.deltaTime < 0 ? COLORS.green : COLORS.textDim), flex: "1 1 140px" }}>
              <div style={styles.metricLabel}>Time-Based Δ</div>
              <div style={{ ...styles.metricValue, color: adjustments.deltaTime === 0 ? COLORS.textDim : adjustments.deltaTime > 0 ? COLORS.red : COLORS.green }}>
                {formatDelta(adjustments.deltaTime, true)}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>{weekOffset === 0 && otMode !== "none" ? `${Math.round(calendarWeeks)} wks vs ${baseWeeks} base` : weekOffset > 0 ? `+${weekOffset} wks burn` : `${weekOffset} wks saved`}</div>
            </div>
            <div style={{ ...styles.metric(adjustments.deltaEAC > 0 ? COLORS.red : adjustments.deltaEAC < 0 ? COLORS.green : COLORS.textDim), flex: "1 1 140px" }}>
              <div style={styles.metricLabel}>Total EAC Δ</div>
              <div style={{ ...styles.metricValue, color: adjustments.deltaEAC === 0 ? COLORS.textDim : adjustments.deltaEAC > 0 ? COLORS.red : COLORS.green }}>
                {formatDelta(adjustments.deltaEAC, true)}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>
                {formatCurrency(adjustments.totalOrigEAC)} → {formatCurrency(adjustments.totalAdjEAC)}
              </div>
            </div>
          </div>

          {/* OT Mode Comparison at current offset */}
          {otMode !== "none" && (() => {
            const modes = [
              { key: "none", label: "No OT", color: COLORS.textDim },
              { key: "sat", label: "Sat OT", color: COLORS.orange },
              { key: "satSun", label: "Sat+Sun OT", color: "#fbbf24" },
            ];
            const compRows = modes.map((m) => {
              const cap = getOtCapacity(m.key);
              const mMinWeeks = getMinWeeks(baseWeeks, cap, hoursData, xerSchedule);
              const canReach = adjustedWeeks >= mMinWeeks;
              if (!canReach) return { ...m, canReach: false };
              const pf = getNonLinearPF(adjustedWeeks, baseWeeks, cap, hoursData);
              const stackPenalties = computeStackingPenalties(hoursData, baseWeeks, adjustedWeeks);
              const directCost = disciplines.reduce((s, d) => {
                const origHours = hoursData[d.id] || new Array(baseWeeks).fill(0);
                return s + computeEnhancedCost(origHours, d.rate, d.otRate, m.key, baseWeeks, adjustedWeeks, pf, stackPenalties, RISK_BANDS.P50);
              }, 0);
              const totalHrs = disciplines.reduce((s, d) => s + (hoursData[d.id] || []).reduce((a, b) => a + b, 0), 0);
              const blended = totalHrs > 0 ? directCost / totalHrs : 0;
              const calW = adjustedWeeks;
              const endD = new Date(startDate);
              endD.setDate(endD.getDate() + Math.round(calW * 7) - 1); snapToSunday(endD);
              const weeklyTimeCost = timeCosts.reduce((s, t) => {
                if (t.basis === "weekly") return s + t.rate;
                if (t.basis === "monthly") return s + t.rate / 4.33;
                return s;
              }, 0);
              const timeCost = weeklyTimeCost * calW;
              return {
                ...m, canReach: true, pf, blendedRate: blended,
                calWeeks: Math.round(calW * 10) / 10, endDate: endD,
                directCost, timeCost, totalCost: directCost + timeCost,
                isActive: m.key === otMode,
              };
            });
            return (
              <div style={{ ...styles.card, marginBottom: 16, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  OT Mode Comparison {weekOffset === 0 ? "at Baseline" : `at ${weekOffset} wk offset`}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {compRows.map((r) => (
                    <div key={r.key} style={{
                      flex: "1 1 180px", padding: "10px 12px", borderRadius: 6,
                      background: r.isActive ? r.color + "12" : COLORS.surface,
                      border: `1px solid ${r.isActive ? r.color : COLORS.border}`,
                      opacity: r.canReach ? 1 : 0.4,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: r.color, marginBottom: 6 }}>
                        {r.label} {r.isActive && "●"}
                      </div>
                      {r.canReach ? (
                        <div style={{ display: "grid", gap: 3 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>PF</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{r.pf.toFixed(3)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>Blended Rate</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>${r.blendedRate.toFixed(2)}/hr</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>Calendar</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{r.calWeeks} wks</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>End Date</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{r.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          </div>
                          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 3, marginTop: 2, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>Direct</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{formatCurrency(r.directCost)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ color: COLORS.textDim }}>Time-Based</span>
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{formatCurrency(r.timeCost)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginTop: 2 }}>
                            <span style={{ color: r.color }}>Total EAC</span>
                            <span style={{ color: r.color }}>{formatCurrency(r.totalCost)}</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>
                          Cannot reach {weekOffset} wk offset (min: {getMinWeeks(baseWeeks, getOtCapacity(r.key), hoursData, xerSchedule)} wks)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 8, lineHeight: 1.4 }}>
                  OT ramps progressively — the number of OT weeks increases as you compress the schedule.
                  Modes differ in compression capacity ({getMinWeeks(baseWeeks, getOtCapacity("sat"), hoursData, xerSchedule)} vs {getMinWeeks(baseWeeks, getOtCapacity("satSun"), hoursData, xerSchedule)} min wks). Uses non-linear PF (BRT α={PF_CURVE_ALPHA}), MCAA cumulative OT fatigue, and trade stacking penalties.
                </div>
              </div>
            );
          })()}

          {/* Discipline Additional Degradation */}
          <div style={{ ...styles.card, borderColor: COLORS.purple + "44", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={styles.cardTitle}>Discipline Productivity Adjustments</div>
                <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: -8 }}>
                  Additional degradation beyond model PF ({adjustments.effectivePF.toFixed(3)}). Factor 1.00 = no extra loss.
                </div>
              </div>
              {Object.keys(disciplinePFs).length > 0 && (
                <button
                  style={{ ...styles.btn("default"), fontSize: 10, padding: "4px 10px" }}
                  onClick={() => setDisciplinePFs({})}
                >
                  Reset All
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {disciplines.map((d, di) => {
                const hasAdj = disciplinePFs[d.id] !== undefined && disciplinePFs[d.id] !== null;
                const addlFactor = hasAdj ? disciplinePFs[d.id] : 1.0;
                const effectivePF = adjustments.effectivePF * addlFactor;
                const costImpact = hasAdj ? (1 / effectivePF - 1 / adjustments.effectivePF) : 0;
                return (
                  <div key={d.id} style={{
                    flex: "1 1 180px",
                    background: hasAdj ? COLORS.surfaceAlt : "transparent",
                    border: `1px solid ${hasAdj ? COLORS.purple + "66" : COLORS.border}`,
                    borderRadius: 6,
                    padding: "10px 14px",
                    transition: "all 0.15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: DISCIPLINE_COLORS[di % DISCIPLINE_COLORS.length] }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>{d.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StepperInput
                        value={Math.round(addlFactor * 1000) / 1000}
                        onChange={(v) => {
                          const rounded = Math.round(v * 1000) / 1000;
                          if (Math.abs(rounded - 1.0) < 0.001) {
                            const next = { ...disciplinePFs };
                            delete next[d.id];
                            setDisciplinePFs(next);
                          } else {
                            setDisciplinePFs({ ...disciplinePFs, [d.id]: rounded });
                          }
                        }}
                        step={0.01}
                        min={0.5}
                        max={1.0}
                        width={60}
                        color={addlFactor < 0.98 ? COLORS.red : COLORS.text}
                      />
                      {hasAdj ? (
                        <button
                          onClick={() => {
                            const next = { ...disciplinePFs };
                            delete next[d.id];
                            setDisciplinePFs(next);
                          }}
                          style={{ background: "transparent", border: "none", color: COLORS.textDim, fontSize: 10, cursor: "pointer", fontFamily: FONT, textDecoration: "underline" }}
                        >
                          reset
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: COLORS.textMuted }}>none</span>
                      )}
                    </div>
                    {hasAdj && (
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>
                        Effective PF: <span style={{ fontWeight: 600, color: COLORS.purple }}>{effectivePF.toFixed(3)}</span>
                        {Math.abs(costImpact) > 0.0001 && (
                          <span style={{ color: costImpact > 0 ? COLORS.red : COLORS.green, fontWeight: 600 }}>
                            {" "}({costImpact > 0 ? "+" : ""}{(costImpact * 100).toFixed(1)}% cost)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* View mode toggle */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: 3, width: "fit-content" }}>
            {[
              { key: "cost_delta", label: "Cost Δ" },
              { key: "cost_compare", label: "Cost Base vs Adj" },
              { key: "hours_delta", label: "Hours Δ" },
              { key: "hours_compare", label: "Hours Base vs Adj" },
            ].map((m) => (
              <button
                key={m.key}
                style={{
                  ...styles.btn(viewMode === m.key ? "primary" : "default"),
                  padding: "6px 14px",
                  fontSize: 11,
                  borderRadius: 3,
                  border: "none",
                  background: viewMode === m.key ? COLORS.purple : "transparent",
                  color: viewMode === m.key ? COLORS.bg : COLORS.textDim,
                }}
                onClick={() => setViewMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Main delta table */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              {viewMode === "hours_delta" && "Weekly Hours — Change from Baseline"}
              {viewMode === "hours_compare" && "Weekly Hours — Base vs Adjusted"}
              {viewMode === "cost_delta" && "Weekly Cost — Change from Baseline"}
              {viewMode === "cost_compare" && "Weekly Cost — Base vs Adjusted"}
            </div>
            <div ref={mainScrollRef} onScroll={() => syncScroll(mainScrollRef, timeScrollRef)} style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 4 }}>
              <table style={{ ...styles.table, fontSize: 11 }}>
                <thead>
                  <tr style={{ background: COLORS.surfaceAlt }}>
                    <th style={{ ...styles.th, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 170, top: 0 }}>Discipline</th>
                    {viewMode.includes("compare") && (
                      <th style={{ ...styles.th, position: "sticky", left: 170, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 50, top: 0, textAlign: "center", fontSize: 10 }}>Row</th>
                    )}
                    {weeksArr.map((w) => {
                      const weekDate = new Date(startDate);
                      weekDate.setDate(weekDate.getDate() + w * 7); snapToSunday(weekDate);
                      const isExtension = w >= baseWeeks;
                      const isTruncated = w >= adjustedWeeks && adjustedWeeks < baseWeeks;
                      return (
                        <th key={w} style={{
                          ...styles.th, textAlign: "center", minWidth: 68, padding: "5px 3px", top: 0, zIndex: 2,
                          background: isExtension ? `${COLORS.red}11` : isTruncated ? `${COLORS.green}11` : COLORS.surfaceAlt,
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 10 }}>Wk {w + 1}</div>
                          <div style={{ fontSize: 8, fontWeight: 400, color: COLORS.textMuted }}>{weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                        </th>
                      );
                    })}
                    <th style={{ ...styles.th, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 90, textAlign: "right", top: 0 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.discData.map((disc, di) => {
                    const color = DISCIPLINE_COLORS[di % DISCIPLINE_COLORS.length];
                    const isDelta = viewMode === "hours_delta" || viewMode === "cost_delta";
                    const isCost = viewMode === "cost_delta" || viewMode === "cost_compare";

                    if (isDelta) {
                      // Single row per discipline showing delta
                      const totalDelta = isCost ? disc.deltaCost : disc.deltaHours;
                      return (
                        <tr key={disc.id} style={{ background: di % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22` }}>
                          <td style={{ ...styles.td, position: "sticky", left: 0, background: di % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, fontWeight: 600, whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 8, verticalAlign: "middle" }} />
                            {disc.name}
                          </td>
                          {disc.weeks.map((wk, wi) => {
                            const val = isCost ? wk.deltaCost : wk.deltaHours;
                            return (
                              <td key={wi} style={{
                                ...styles.td, ...cellNum, fontSize: 10, padding: "5px 3px",
                                color: deltaColor(val, "textOnBg"),
                                background: val !== 0 ? deltaColor(val, "bg") : "transparent",
                                fontWeight: val !== 0 ? 600 : 400,
                              }}>
                                {val === 0 ? "—" : isCost ? formatDelta(val, true) : formatDelta(val)}
                              </td>
                            );
                          })}
                          <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: di % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, color: deltaColor(totalDelta) }}>
                            {formatDelta(totalDelta, isCost)}
                          </td>
                        </tr>
                      );
                    } else {
                      // Two rows per discipline: base then adjusted
                      const baseTotal = isCost ? disc.origCostTotal : disc.totalOrigHours;
                      const adjTotal = isCost ? disc.adjCostTotal : disc.totalAdjHours;
                      return [
                        <tr key={`${disc.id}-base`} style={{ background: `${COLORS.surfaceAlt}11` }}>
                          <td rowSpan={2} style={{ ...styles.td, position: "sticky", left: 0, background: COLORS.surface, zIndex: 2, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "middle", borderBottom: `1px solid ${COLORS.border}44` }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 8, verticalAlign: "middle" }} />
                            {disc.name}
                          </td>
                          <td style={{ ...styles.td, position: "sticky", left: 170, background: COLORS.surface, zIndex: 2, fontSize: 9, color: COLORS.textMuted, textAlign: "center", textTransform: "uppercase" }}>Base</td>
                          {disc.weeks.map((wk, wi) => (
                            <td key={wi} style={{ ...styles.td, ...cellNum, fontSize: 10, padding: "4px 3px", color: (isCost ? wk.baseCost : wk.baseHours) > 0 ? COLORS.textDim : COLORS.textMuted + "33" }}>
                              {isCost ? (wk.baseCost > 0 ? formatCurrency(wk.baseCost) : "—") : (wk.baseHours > 0 ? formatNumber(wk.baseHours) : "—")}
                            </td>
                          ))}
                          <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: COLORS.surface, zIndex: 2, fontWeight: 600, color: COLORS.textDim }}>
                            {isCost ? formatCurrency(baseTotal) : formatNumber(baseTotal)}
                          </td>
                        </tr>,
                        <tr key={`${disc.id}-adj`} style={{ borderBottom: `2px solid ${COLORS.border}44` }}>
                          <td style={{ ...styles.td, position: "sticky", left: 170, background: COLORS.surface, zIndex: 2, fontSize: 9, color: COLORS.accent, textAlign: "center", textTransform: "uppercase", fontWeight: 600 }}>Adj</td>
                          {disc.weeks.map((wk, wi) => {
                            const val = isCost ? wk.adjCost : wk.adjHours;
                            const base = isCost ? wk.baseCost : wk.baseHours;
                            const changed = val !== base;
                            return (
                              <td key={wi} style={{
                                ...styles.td, ...cellNum, fontSize: 10, padding: "4px 3px",
                                color: val > 0 ? (changed ? COLORS.accent : COLORS.text) : COLORS.textMuted + "33",
                                fontWeight: changed ? 700 : 400,
                              }}>
                                {isCost ? (val > 0 ? formatCurrency(val) : "—") : (val > 0 ? formatNumber(val) : "—")}
                              </td>
                            );
                          })}
                          <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: COLORS.surface, zIndex: 2, fontWeight: 700, color: COLORS.accent }}>
                            {isCost ? formatCurrency(adjTotal) : formatNumber(adjTotal)}
                          </td>
                        </tr>,
                      ];
                    }
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: COLORS.surfaceAlt, borderTop: `2px solid ${COLORS.accent}44` }}>
                    <td style={{ ...styles.td, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.5px", color: COLORS.accent }} colSpan={viewMode.includes("compare") ? 2 : 1}>Total Direct</td>
                    {weeksArr.map((w) => {
                      const isDelta = viewMode === "hours_delta" || viewMode === "cost_delta";
                      const isCost = viewMode === "cost_delta" || viewMode === "cost_compare";
                      const val = adjustments.discData.reduce((s, d) => {
                        const wk = d.weeks[w];
                        if (!wk) return s;
                        if (isDelta) return s + (isCost ? wk.deltaCost : wk.deltaHours);
                        return s + (isCost ? wk.adjCost : wk.adjHours);
                      }, 0);
                      return (
                        <td key={w} style={{ ...styles.td, ...cellNum, fontWeight: 600, fontSize: 10, color: isDelta ? deltaColor(val) : (val > 0 ? COLORS.text : COLORS.textMuted) }}>
                          {isDelta ? formatDelta(val, isCost) : (isCost ? formatCurrency(val) : formatNumber(val))}
                        </td>
                      );
                    })}
                    <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, color: COLORS.accent }}>
                      {(() => {
                        const isDelta = viewMode === "hours_delta" || viewMode === "cost_delta";
                        const isCost = viewMode === "cost_delta" || viewMode === "cost_compare";
                        if (isDelta) {
                          const v = isCost ? adjustments.deltaDirect : adjustments.discData.reduce((s, d) => s + d.deltaHours, 0);
                          return <span style={{ color: deltaColor(v) }}>{formatDelta(v, isCost)}</span>;
                        }
                        return isCost ? formatCurrency(adjustments.totalAdjDirect) : formatNumber(adjustments.discData.reduce((s, d) => s + d.totalAdjHours, 0));
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Time-Based Cost Delta */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Time-Based Cost — Change from Baseline</div>
            <div ref={timeScrollRef} onScroll={() => syncScroll(timeScrollRef, mainScrollRef)} style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 4 }}>
              <table style={{ ...styles.table, fontSize: 11 }}>
                <thead>
                  <tr style={{ background: COLORS.surfaceAlt }}>
                    <th style={{ ...styles.th, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 200, top: 0 }}>Cost Item</th>
                    {weeksArr.map((w) => {
                      const isExtension = w >= baseWeeks;
                      return (
                        <th key={w} style={{ ...styles.th, textAlign: "center", minWidth: 68, padding: "5px 3px", top: 0, zIndex: 2, background: isExtension ? `${COLORS.red}11` : COLORS.surfaceAlt }}>
                          <div style={{ fontWeight: 700, fontSize: 10 }}>Wk {w + 1}</div>
                        </th>
                      );
                    })}
                    <th style={{ ...styles.th, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 5, minWidth: 90, textAlign: "right", top: 0 }}>Δ Total</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.tcData.map((tc, ti) => (
                    <tr key={tc.id} style={{ background: ti % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}22` }}>
                      <td style={{ ...styles.td, position: "sticky", left: 0, background: ti % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, fontWeight: 600, whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: COLORS.accent, marginRight: 8, verticalAlign: "middle" }} />
                        {tc.name}
                      </td>
                      {tc.weeks.map((wk, wi) => (
                        <td key={wi} style={{
                          ...styles.td, ...cellNum, fontSize: 10, padding: "5px 3px",
                          color: deltaColor(wk.delta, "textOnBg"),
                          background: wk.delta !== 0 ? deltaColor(wk.delta, "bg") : "transparent",
                          fontWeight: wk.delta !== 0 ? 600 : 400,
                        }}>
                          {wk.delta === 0 ? "—" : formatDelta(wk.delta, true)}
                        </td>
                      ))}
                      <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: ti % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, color: deltaColor(tc.delta) }}>
                        {formatDelta(tc.delta, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: COLORS.surfaceAlt, borderTop: `2px solid ${COLORS.accent}44` }}>
                    <td style={{ ...styles.td, position: "sticky", left: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, textTransform: "uppercase", fontSize: 10, color: COLORS.accent }}>Total Time-Based Δ</td>
                    {weeksArr.map((w) => {
                      const val = adjustments.tcData.reduce((s, tc) => s + (tc.weeks[w]?.delta || 0), 0);
                      return (
                        <td key={w} style={{ ...styles.td, ...cellNum, fontWeight: 600, fontSize: 10, color: deltaColor(val, "textOnBg"), background: val !== 0 ? deltaColor(val, "bg") : "transparent" }}>
                          {val === 0 ? "—" : formatDelta(val, true)}
                        </td>
                      );
                    })}
                    <td style={{ ...styles.td, ...cellNum, position: "sticky", right: 0, background: COLORS.surfaceAlt, zIndex: 2, fontWeight: 700, color: deltaColor(adjustments.deltaTime) }}>
                      {formatDelta(adjustments.deltaTime, true)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Grand total summary bar */}
          <div style={{ ...styles.card, background: `linear-gradient(135deg, ${COLORS.surfaceAlt}, ${COLORS.surface})`, borderColor: COLORS.purple + "44" }}>
            <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 20 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: COLORS.textDim, textTransform: "uppercase" }}>Base EAC</div>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: COLORS.textDim }}>{formatCurrency(adjustments.totalOrigEAC)}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: COLORS.textDim, textTransform: "uppercase" }}>Direct Δ</div>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: deltaColor(adjustments.deltaDirect) }}>{formatDelta(adjustments.deltaDirect, true)}</div>
              </div>
              <div style={{ fontSize: 24, color: COLORS.textMuted, alignSelf: "center" }}>+</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: COLORS.textDim, textTransform: "uppercase" }}>Time Δ</div>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: deltaColor(adjustments.deltaTime) }}>{formatDelta(adjustments.deltaTime, true)}</div>
              </div>
              <div style={{ fontSize: 24, color: COLORS.textMuted, alignSelf: "center" }}>=</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: COLORS.accent, textTransform: "uppercase", fontWeight: 700 }}>Adjusted EAC</div>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 700, color: COLORS.accent }}>{formatCurrency(adjustments.totalAdjEAC)}</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ ...styles.card, textAlign: "center", padding: 60 }}>
          <div style={{ fontFamily: DISPLAY_FONT, fontSize: 18, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>
            Move the slider or enable OT to see adjustments
          </div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 8 }}>
            This tab shows the week-by-week changes to hours, costs, and time-based expenses compared to the baseline data.
          </div>
        </div>
      )}
    </div>
  );
}

// ModelsTab component — paste before `export default function CostForecastApp()`

function ModelsTab({ baseWeeks, hoursData, disciplines, xerSchedule }) {
  const COLORS = useColors();
  const styles = getStyles(COLORS);

  // ── 1. Non-Linear PF Power Curve data ──
  const pfCurveData = useMemo(() => {
    const data = [];
    for (let pct = 0; pct <= 100; pct += 2) {
      const frac = pct / 100;
      const row = { compression: pct };
      [1.0, 1.4, 1.8, 2.2, 2.6].forEach(alpha => {
        const pfLoss = Math.pow(frac, alpha);
        row[`α${alpha}`] = +(1.0 - 0.15 * pfLoss).toFixed(4); // using ACCEL_PF=0.85 as reference
      });
      data.push(row);
    }
    return data;
  }, []);

  // ── 2. MCAA Fatigue Curve data ──
  const mcaaData = useMemo(() => {
    const data = [];
    for (let w = 0; w <= 20; w++) {
      data.push({
        week: w,
        "50 hr/wk (Sat OT)": getMCAAFatigue("sat", w),
        "60 hr/wk (Sat+Sun OT)": getMCAAFatigue("satSun", w),
      });
    }
    return data;
  }, []);

  // ── 3. Trade Stacking data ──
  const stackingData = useMemo(() => {
    const data = [];
    for (let trades = 1; trades <= 8; trades++) {
      const row = { trades };
      [0.8, 1.0, 1.5, 2.0].forEach(density => {
        const penalty = trades <= 1 ? 0 : Math.min(STACKING_MAX, STACKING_K * (trades - 1) * Math.max(1, density));
        row[`d${density}`] = +(penalty * 100).toFixed(1);
      });
      data.push(row);
    }
    return data;
  }, []);

  // ── 4. OT Progressive Model data ──
  const otProgressiveData = useMemo(() => {
    const data = [];
    const otCap50 = getOtCapacity("sat");
    const otCap60 = getOtCapacity("satSun");
    for (let w = baseWeeks; w >= Math.max(8, Math.ceil(baseWeeks * 0.6)); w--) {
      const compression = baseWeeks - w;
      data.push({
        duration: w,
        compression,
        "Sat OT Weeks": getOtWeeks(w, baseWeeks, "sat"),
        "Sat+Sun OT Weeks": getOtWeeks(w, baseWeeks, "satSun"),
        "Sat Utilization": +(getOtUtilization(w, baseWeeks, "sat") * 100).toFixed(1),
        "SatSun Utilization": +(getOtUtilization(w, baseWeeks, "satSun") * 100).toFixed(1),
      });
    }
    return data.reverse();
  }, [baseWeeks]);

  // ── 5. Risk Band Sensitivity data ──
  const riskBandData = useMemo(() => {
    return Object.entries(RISK_BANDS).map(([key, band]) => ({
      band: band.label,
      key,
      "PF Amplification": `×${band.pfScale.toFixed(2)}`,
      "Fatigue Amplification": `×${band.fatigueScale.toFixed(2)}`,
      "Stacking Amplification": `×${band.stackScale.toFixed(2)}`,
      pfScale: band.pfScale,
      fatigueScale: band.fatigueScale,
      stackScale: band.stackScale,
    }));
  }, []);

  const riskChartData = useMemo(() => {
    return [
      { factor: "PF Scale", P50: 1.0, P80: 1.25, P90: 1.50 },
      { factor: "Fatigue Scale", P50: 1.0, P80: 1.15, P90: 1.30 },
      { factor: "Stacking Scale", P50: 1.0, P80: 1.20, P90: 1.40 },
    ];
  }, []);

  // ── 6. Hours redistribution example ──
  const redistributionData = useMemo(() => {
    // Use first discipline's hours as example
    const firstDiscId = disciplines[0]?.id;
    const origHours = hoursData[firstDiscId] || [];
    if (origHours.length === 0) return [];

    const compressed = redistributeHours(origHours, baseWeeks, Math.max(8, Math.round(baseWeeks * 0.75)));
    const extended = redistributeHours(origHours, baseWeeks, Math.round(baseWeeks * 1.25));
    const data = [];
    const maxLen = Math.max(origHours.length, compressed.length, extended.length);
    for (let w = 0; w < maxLen; w++) {
      data.push({
        week: w + 1,
        "Baseline": origHours[w] || 0,
        "Compressed (75%)": compressed[w] || 0,
        "Extended (125%)": extended[w] || 0,
      });
    }
    return data;
  }, [disciplines, hoursData, baseWeeks]);

  // ── 7. Combined cost multiplier cascade ──
  const cascadeData = useMemo(() => {
    const weeks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    return weeks.map(frac => {
      const pf = 1.0 - 0.15 * Math.pow(frac, PF_CURVE_ALPHA);
      const pfMult = 1 / pf;
      const fatiguePI = getMCAAFatigue("sat", Math.round(frac * 12));
      const fatigueMult = 1 / Math.max(0.35, fatiguePI);
      const stackPenalty = Math.min(STACKING_MAX, STACKING_K * 3 * Math.max(1, 1 + frac));
      const stackMult = 1 + stackPenalty;
      const combined = pfMult * fatigueMult * stackMult;
      return {
        compression: `${Math.round(frac * 100)}%`,
        "PF Multiplier": +pfMult.toFixed(3),
        "Fatigue Multiplier": +fatigueMult.toFixed(3),
        "Stacking Multiplier": +stackMult.toFixed(3),
        "Combined": +combined.toFixed(3),
      };
    });
  }, []);

  const sectionStyle = { marginBottom: 8 };
  const descStyle = { fontSize: 12, color: COLORS.textDim, lineHeight: 1.6, marginBottom: 14 };
  const formulaStyle = {
    background: COLORS.surfaceAlt || COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4, padding: "10px 16px",
    fontFamily: FONT, fontSize: 12,
    color: COLORS.accent, marginBottom: 14,
    overflowX: "auto", whiteSpace: "pre",
    lineHeight: 1.7,
  };
  const refStyle = { fontSize: 11, color: COLORS.textMuted, fontStyle: "italic", marginTop: 8, lineHeight: 1.5 };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: COLORS.text }}>
          Model Reference
        </div>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
          Mathematical models, empirical data sources, and parametric assumptions used in the EAC forecast engine
        </div>
      </div>

      {/* ═══ 1. Non-Linear PF Power Curve ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>1 — Non-Linear Productivity Factor (Power Curve)</div>
        <div style={descStyle}>
          Models the relationship between schedule compression and labor productivity loss.
          Based on BRT (1980) and Thomas/Penn State (1997) empirical data showing that
          initial compression absorbs organizational slack with minimal loss, while severe
          compression produces steep, non-linear productivity degradation. The model uses a
          power curve fitted to averaged industry data (R² ≈ 0.94).
        </div>
        <div style={formulaStyle}>
{`PF(c) = 1.0 + (ACCEL_PF - 1.0) × c^α

  c = compression fraction = (baseWeeks - targetWeeks) / (baseWeeks - minWeeks)
  α = ${PF_CURVE_ALPHA} (power exponent, fitted to BRT/MCAA data)
  ACCEL_PF = ${ACCEL_PF} (fixed, BRT empirical max loss at full compression)`}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={pfCurveData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="compression" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
              label={{ value: "Compression %", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} domain={[0.82, 1.01]}
              label={{ value: "Productivity Factor", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
            <Line type="monotone" dataKey="α1" name="α=1.0 (Linear)" stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="4 4" dot={false} />
            <Line type="monotone" dataKey="α1.4" name="α=1.4" stroke={COLORS.blue || "#60a5fa"} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey={`α${PF_CURVE_ALPHA}`} name={`α=${PF_CURVE_ALPHA} (Active)`} stroke={COLORS.accent} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="α2.2" name="α=2.2" stroke={COLORS.purple || "#a78bfa"} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="α2.6" name="α=2.6" stroke={COLORS.red} strokeWidth={1} strokeDasharray="4 4" dot={false} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </LineChart>
        </ResponsiveContainer>
        <div style={refStyle}>Sources: BRT, "More Construction for the Money" (1983); Thomas, H.R., Horner, R.M.W., "Productivity Modeling" (1997); MCAA Bulletin OT1 Rev. (2011)</div>
      </div>

      {/* ═══ 2. MCAA Cumulative OT Fatigue ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>2 — MCAA Cumulative Overtime Fatigue</div>
        <div style={descStyle}>
          Models the progressive decline in worker productivity as consecutive overtime weeks
          accumulate. Based on averaged empirical data from four independent studies conducted
          between 1979-1997. The Productivity Index (PI) represents the fraction of normal
          output achieved; a PI of 0.80 means workers produce only 80% of their normal output,
          requiring 25% more hours to complete the same work scope.
        </div>
        <div style={formulaStyle}>
{`Effective Cost Multiplier = 1 / PI(otMode, consecutiveWeek)

PI sourced from MCAA Bulletin OT1 lookup tables:
  50 hr/wk: [1.00, 0.95, 0.93, 0.91, 0.89, 0.87, 0.85, 0.83, 0.80, 0.76, 0.72, ...]
  60 hr/wk: [1.00, 0.91, 0.89, 0.85, 0.82, 0.78, 0.75, 0.72, 0.69, 0.66, 0.61, ...]

Beyond table range: linear extrapolation with floor of 0.35`}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={mcaaData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="week" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
              label={{ value: "Consecutive OT Week", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} domain={[0.3, 1.05]}
              label={{ value: "Productivity Index (PI)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
            <ReferenceLine y={1.0} stroke={COLORS.textMuted} strokeDasharray="5 5" />
            <ReferenceLine y={0.7} stroke={COLORS.red} strokeDasharray="3 3" label={{ value: "Severe", position: "right", fontSize: 9, fill: COLORS.red }} />
            <Line type="monotone" dataKey="50 hr/wk (Sat OT)" stroke={COLORS.orange} strokeWidth={2.5} dot={{ r: 2.5, fill: COLORS.orange }} />
            <Line type="monotone" dataKey="60 hr/wk (Sat+Sun OT)" stroke={COLORS.red} strokeWidth={2.5} dot={{ r: 2.5, fill: COLORS.red }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </LineChart>
        </ResponsiveContainer>
        <div style={refStyle}>Sources: Hanna, A.S., Sullivan, K.T., Lackney, J.A. (2004); Hanna, Taylor, Sullivan (2005) ASCE JCEM; BRT (1980); NECA (1989); Thomas/Penn State (1997); US Army COE (1979)</div>
      </div>

      {/* ═══ 3. Trade Stacking Penalty ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>3 — Trade Stacking / Congestion Penalty</div>
        <div style={descStyle}>
          Accounts for productivity loss when multiple trades work concurrently in compressed
          space. Based on Hanna et al. (2007) ASCE JCEM data showing 0-41% productivity loss
          from overmanning. <strong>Only the incremental stacking beyond the baseline plan is penalized</strong> —
          stacking that already exists in the original schedule is embedded in the base cost.
          The model considers both the number of concurrent trades and the
          labor density (ratio of current hours to baseline average hours per week).
        </div>
        <div style={formulaStyle}>
{`Raw(w) = min(${(STACKING_MAX * 100).toFixed(0)}%, K × (activeTrades - 1) × max(1, density))
Net Penalty(w) = max(0, Raw(w) - baselineAvgPenalty)

  K = ${STACKING_K} (${(STACKING_K * 100).toFixed(0)}% per additional trade)
  density = weekHours / baselineAvgWeekHours
  baselineAvgPenalty = avg raw penalty across baseline schedule
  Cap = ${(STACKING_MAX * 100).toFixed(0)}% (MCAA severe range upper bound)
  activeTrades = disciplines with hours > 0 in week w`}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stackingData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="trades" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
              label={{ value: "Concurrent Trades", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} unit="%"
              label={{ value: "Stacking Penalty %", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} formatter={(v) => `${v}%`} />
            <Bar dataKey="d0.8" name="Density 0.8×" fill={COLORS.blue || "#60a5fa"} opacity={0.5} radius={[2,2,0,0]} />
            <Bar dataKey="d1" name="Density 1.0×" fill={COLORS.accent} opacity={0.7} radius={[2,2,0,0]} />
            <Bar dataKey="d1.5" name="Density 1.5×" fill={COLORS.orange} opacity={0.8} radius={[2,2,0,0]} />
            <Bar dataKey="d2" name="Density 2.0×" fill={COLORS.red} opacity={0.9} radius={[2,2,0,0]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={STACKING_MAX * 100} stroke={COLORS.red} strokeDasharray="5 5" label={{ value: `Cap ${STACKING_MAX * 100}%`, position: "right", fontSize: 9, fill: COLORS.red }} />
          </BarChart>
        </ResponsiveContainer>
        <div style={refStyle}>Source: Hanna, A.S., Taylor, C.S., Sullivan, K.T. (2007) "Impact of Overmanning on Mechanical and Sheet Metal Construction" ASCE JCEM</div>
      </div>

      {/* ═══ 4. Progressive OT Model ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>4 — Progressive Overtime Allocation</div>
        <div style={descStyle}>
          OT weeks are applied progressively from the end of the compressed schedule backward.
          This reflects the practical reality that OT is typically ramped up toward project
          completion deadlines. The number of OT weeks depends on the compression amount and
          the OT capacity (hours per week). Base work week is 5×10 = 50 hours; Saturday OT adds
          10 hours (60 hr/wk), Saturday + Sunday adds 20 hours (70 hr/wk).
        </div>
        <div style={formulaStyle}>
{`OT Weeks = round((baseWeeks - targetWeeks) × 50 / otHoursPerDay)

  Sat OT:     60 hr/wk → factor 1.20 → otHrs = 10/wk
  Sat+Sun OT: 70 hr/wk → factor 1.40 → otHrs = 20/wk

Blended Rate = (50 × baseRate + otHrs × otRate) / totalHrsPerWeek
OT weeks placed at: weeks [targetWeeks - numOtWeeks] through [targetWeeks - 1]`}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={otProgressiveData} margin={{ top: 8, right: 40, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="duration" stroke={COLORS.textMuted} tick={{ fontSize: 10 }} reversed
              label={{ value: "Project Duration (weeks)", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis yAxisId="weeks" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
              label={{ value: "OT Weeks Required", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis yAxisId="pct" orientation="right" stroke={COLORS.textMuted} tick={{ fontSize: 10 }} unit="%"
              label={{ value: "OT Utilization %", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
            <Bar yAxisId="weeks" dataKey="Sat OT Weeks" fill={COLORS.orange} opacity={0.6} radius={[2,2,0,0]} />
            <Bar yAxisId="weeks" dataKey="Sat+Sun OT Weeks" fill={COLORS.red} opacity={0.5} radius={[2,2,0,0]} />
            <Line yAxisId="pct" type="monotone" dataKey="Sat Utilization" name="Sat OT %" stroke={COLORS.orange} strokeWidth={2} dot={false} />
            <Line yAxisId="pct" type="monotone" dataKey="SatSun Utilization" name="Sat+Sun OT %" stroke={COLORS.red} strokeWidth={2} dot={false} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ═══ 5. Risk Band Sensitivity ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>5 — Risk Band Sensitivity (P50 / P80 / P90)</div>
        <div style={descStyle}>
          Generates probabilistic cost ranges by amplifying penalty factors. Based on AACE
          Recommended Practice 42R-08 contingency ranges for construction cost estimates.
          Each risk band scales the three penalty models (PF, fatigue, stacking) independently
          to produce a range of plausible cost outcomes.
        </div>
        <div style={formulaStyle}>
{`P50 (Expected):      PF×1.00  Fatigue×1.00  Stacking×1.00
P80 (Pessimistic):   PF×1.25  Fatigue×1.15  Stacking×1.20
P90 (V.Pessimistic): PF×1.50  Fatigue×1.30  Stacking×1.40

Scaled PF Loss  = (1 - basePF) × pfScale
Scaled Fatigue  = 1 - (1 - PI) × fatigueScale
Scaled Stacking = stackPenalty × stackScale`}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={riskChartData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="factor" stroke={COLORS.textMuted} tick={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} domain={[0.8, 1.6]} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
            <Bar dataKey="P50" name="P50 (Expected)" fill={COLORS.green} opacity={0.7} radius={[2,2,0,0]} />
            <Bar dataKey="P80" name="P80" fill={COLORS.orange} opacity={0.7} radius={[2,2,0,0]} />
            <Bar dataKey="P90" name="P90" fill={COLORS.red} opacity={0.7} radius={[2,2,0,0]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </BarChart>
        </ResponsiveContainer>
        <div style={refStyle}>Source: AACE International Recommended Practice 42R-08, "Risk Analysis and Contingency Determination" (2011)</div>
      </div>

      {/* ═══ 6. Hours Redistribution ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>6 — Phase-Aware Hours Redistribution</div>
        <div style={descStyle}>
          Redistributes discipline labor hours when the schedule is compressed or extended.
          The algorithm preserves the cumulative distribution shape (S-curve profile) while
          proportionally scaling the time axis. All discipline positions shift proportionally —
          this matches real schedule acceleration where tasks maintain their relative sequencing
          while the overall timeline compresses or extends.
        </div>
        <div style={formulaStyle}>
{`Compression: Proportional CDF mapping of active span to shorter window
Extension:   Proportional stretch of entire curve across longer window

For each new week w in [0, newLen):
  startFrac = w / newLen
  endFrac   = (w + 1) / newLen
  hours[w]  = totalHours × (CDF(endFrac) - CDF(startFrac))

Where CDF is interpolated from the original cumulative hour distribution.
Total hours are conserved (Σ remains constant).`}
        </div>
        {redistributionData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={redistributionData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="week" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
                label={{ value: "Week", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
              <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
                label={{ value: "Hours", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
              <Area type="monotone" dataKey="Baseline" stroke={COLORS.textMuted} fill={COLORS.textMuted} fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="Compressed (75%)" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.12} strokeWidth={2} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="Extended (125%)" stroke={COLORS.green} fill={COLORS.green} fillOpacity={0.12} strokeWidth={2} strokeDasharray="4 4" />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div style={refStyle}>Example uses {disciplines[0]?.name || "first discipline"}'s hours profile from the current project data.</div>
      </div>

      {/* ═══ 7. Combined Cost Multiplier Cascade ═══ */}
      <div style={{ ...styles.card, ...sectionStyle }}>
        <div style={styles.cardTitle}>7 — Combined Cost Multiplier Cascade</div>
        <div style={descStyle}>
          The final per-week cost is the product of all three penalty multipliers applied to
          the base labor cost. This compound effect means that severe compression combined
          with extended OT and trade stacking produces exponentially escalating costs — not
          merely additive penalties. The chart below shows how each multiplier stacks at
          increasing compression levels (reference scenario: 4 trades, Sat OT).
        </div>
        <div style={formulaStyle}>
{`WeekCost(w) = hours(w) × rate(w) × (1/PF) × (1/PI) × (1 + stackPenalty)
                         ↑              ↑          ↑              ↑
                    base or OT    compression   fatigue      congestion
                    blended rate   power curve   MCAA table    Hanna model

All multipliers are ≥ 1.0, so the combined effect is always ≥ base cost.`}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={cascadeData} margin={{ top: 8, right: 30, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="compression" stroke={COLORS.textMuted} tick={{ fontSize: 10 }}
              label={{ value: "Compression Level", position: "bottom", offset: 20, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <YAxis stroke={COLORS.textMuted} tick={{ fontSize: 10 }} domain={[0.9, "auto"]}
              label={{ value: "Cost Multiplier", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: COLORS.textDim } }} />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} formatter={(v) => `${v}×`} />
            <ReferenceLine y={1.0} stroke={COLORS.textMuted} strokeDasharray="5 5" />
            <Line type="monotone" dataKey="PF Multiplier" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Fatigue Multiplier" stroke={COLORS.orange} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Stacking Multiplier" stroke={COLORS.purple || "#a78bfa"} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Combined" stroke={COLORS.red} strokeWidth={3} dot={{ r: 4, fill: COLORS.red }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ═══ Parameter Summary ═══ */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Model Parameters Summary</div>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: "30%" }}>Parameter</th>
              <th style={{ ...styles.th, width: "20%" }}>Value</th>
              <th style={styles.th}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["PF_CURVE_ALPHA", PF_CURVE_ALPHA, "Power curve exponent (BRT/MCAA fit)"],
              ["ACCEL_PF", ACCEL_PF, "Max PF at full compression (BRT empirical, fixed)"],
              ["EXTENSION_PF", EXTENSION_PF, "PF for schedule extension (no gain per BRT data)"],
              ["STACKING_K", `${STACKING_K} (${STACKING_K * 100}%)`, "Penalty per additional concurrent trade"],
              ["STACKING_MAX", `${STACKING_MAX} (${STACKING_MAX * 100}%)`, "Maximum stacking penalty cap"],
              ["MCAA 60hr table", "17 entries", "PI values for Saturday OT (5×10 + Sat)"],
              ["MCAA 70hr table", "17 entries", "PI values for Sat+Sun OT (5×10 + Sat+Sun)"],
              ["PI floor", "0.35", "Minimum productivity index (extrapolation floor)"],
              ["P80 PF scale", RISK_BANDS.P80.pfScale, "PF loss amplification at 80th percentile"],
              ["P80 fatigue scale", RISK_BANDS.P80.fatigueScale, "Fatigue amplification at 80th percentile"],
              ["P80 stacking scale", RISK_BANDS.P80.stackScale, "Stacking amplification at 80th percentile"],
              ["P90 PF scale", RISK_BANDS.P90.pfScale, "PF loss amplification at 90th percentile"],
              ["P90 fatigue scale", RISK_BANDS.P90.fatigueScale, "Fatigue amplification at 90th percentile"],
              ["P90 stacking scale", RISK_BANDS.P90.stackScale, "Stacking amplification at 90th percentile"],
              ["Base work week", "50 hrs (5×10)", "Standard crew schedule"],
              ["Sat OT capacity", "60 hrs (50+10)", "Saturday overtime schedule"],
              ["Sat+Sun OT capacity", "70 hrs (50+20)", "Weekend overtime schedule"],
            ].map(([param, val, desc], i) => (
              <tr key={i}>
                <td style={{ ...styles.td, fontFamily: FONT, fontWeight: 600, color: COLORS.accent }}>{param}</td>
                <td style={{ ...styles.td, fontFamily: FONT, fontWeight: 600 }}>{val}</td>
                <td style={{ ...styles.td, color: COLORS.textDim }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── Shared slider sub-components (used in sticky bar + main card) ────────

function OtModeButtons({ otMode, setOtMode, weekOffset, setWeekOffset, baseWeeks, hoursData, xerSchedule, compact = false }) {
  const COLORS = useColors();
  const size = compact ? { padding: "3px 8px", fontSize: 10 } : { padding: "5px 10px", fontSize: 11 };
  return (
    <div style={{ display: "flex", gap: compact ? 2 : 3, background: COLORS.bg, borderRadius: 4, padding: 2 }} role="radiogroup" aria-label="Overtime mode">
      {Object.entries(OT_MODES).map(([key, label]) => (
        <button
          key={key}
          role="radio"
          aria-checked={otMode === key}
          aria-label={`${label} overtime mode`}
          style={{
            ...size, fontWeight: 600, border: "none", borderRadius: 3, cursor: "pointer",
            background: otMode === key ? (key === "none" ? COLORS.textMuted : COLORS.orange) : "transparent",
            color: otMode === key ? COLORS.bg : COLORS.textDim,
            fontFamily: FONT,
          }}
          onClick={() => {
            if (key === "none") {
              setOtMode(key);
              setWeekOffset(0);
            } else if (otMode === "none") {
              setOtMode(key);
              setWeekOffset(0);
            } else {
              setOtMode(key);
              const newMin = getMinWeeks(baseWeeks, getOtCapacity(key), hoursData, xerSchedule);
              setWeekOffset(Math.max(weekOffset, newMin - baseWeeks));
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OtScopeToggle({ otScope, setOtScope, compact = false, disabled = false }) {
  const COLORS = useColors();
  const size = compact ? { padding: "2px 6px", fontSize: 9 } : { padding: "3px 8px", fontSize: 10 };
  const options = [
    { key: "zone", label: "Project-Wide" },
    { key: "task", label: "Task-Specific" },
  ];
  return (
    <div style={{ display: "flex", gap: compact ? 1 : 2, background: COLORS.bg, borderRadius: 3, padding: 1, opacity: disabled ? 0.4 : 1 }} role="radiogroup" aria-label="Overtime scope">
      {options.map(({ key, label }) => (
        <button
          key={key}
          role="radio"
          aria-checked={otScope === key}
          aria-disabled={disabled}
          aria-label={`${label} overtime scope`}
          style={{
            ...size, fontWeight: 600, border: "none", borderRadius: 2,
            cursor: disabled ? "default" : "pointer",
            background: otScope === key ? (disabled ? COLORS.textMuted : COLORS.accent) : "transparent",
            color: otScope === key ? COLORS.bg : COLORS.textDim,
            fontFamily: FONT, whiteSpace: "nowrap",
          }}
          onClick={() => { if (!disabled) setOtScope(key); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DiamondMarkers({ optimalByOt, otMode, sliderMinWeeks, baseWeeks, noOtMaxWeeks, size = 8 }) {
  const COLORS = useColors();
  const sMin = sliderMinWeeks - baseWeeks;
  const sMax = otMode !== "none" ? 0 : noOtMaxWeeks - baseWeeks;
  const range = sMax - sMin;
  if (range === 0) return null;
  return ["sat", "satSun"].map((mode) => {
    const opt = optimalByOt[mode];
    if (!opt) return null;
    const pct = ((opt.offset - sMin) / range) * 100;
    if (pct < 0 || pct > 100) return null;
    return (
      <div key={mode} title={`${OT_MODES[mode]} optimal: ${opt.offset} wks`} style={{
        position: "absolute", top: "50%", left: `${pct}%`,
        transform: "translate(-50%, -50%) rotate(45deg)",
        width: size, height: size,
        background: mode === "sat" ? COLORS.orange : "#fbbf24",
        opacity: otMode === mode ? 0.9 : 0.4,
        pointerEvents: "none", borderRadius: 1,
      }} />
    );
  });
}

function CostForecastApp() {
  const [theme, setTheme] = useState("light");
  const COLORS = theme === "light" ? LIGHT_COLORS : DARK_COLORS;
  const styles = getStyles(COLORS);
  const [activeTab, setActiveTab] = useState("forecast");
  const [sliderSticky, setSliderSticky] = useState(false);
  const sliderSentinelRef = useRef(null);
  const exportRef = useRef(null);
  const pendingExport = useRef(false);

  useEffect(() => {
    const el = sliderSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSliderSticky(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [disciplines, setDisciplines] = useState(defaultDisciplines);
  const [timeCosts, setTimeCosts] = useState(defaultTimeCosts);
  const [hoursData, setHoursData] = useState(defaultHoursData);
  const [baseWeeks, setBaseWeeks] = useState(NUM_WEEKS);
  const [startDate, setStartDate] = useState("2024-09-23");

  // Shared schedule adjustment state (used by Adjustments & EAC Forecast tabs)
  const [weekOffset, setWeekOffset] = useState(0);
  const [otMode, setOtMode] = useState("none");
  const [otScope, setOtScope] = useState("zone"); // "zone" = project-wide OT, "task" = only compressed disciplines
  // Per-discipline PF additional degradation: { [discId]: number } — multiplied with model PF (1.0 = no extra loss)
  const [disciplinePFs, setDisciplinePFs] = useState({});
  // XER schedule for task-level CPM compression (lifted from HoursTab)
  const [xerSchedule, setXerSchedule] = useState(null);

  const otCap = getOtCapacity(otMode);
  const adjustedWeeks = baseWeeks + weekOffset;
  const calendarWeeks = adjustedWeeks;
  // OT extends weekly capacity → allows deeper schedule compression
  const minWeeks = getMinWeeks(baseWeeks, otCap, hoursData, xerSchedule);
  const noOtMaxWeeks = Math.round(baseWeeks * 1.5);
  // With progressive OT: slider goes from minWeeks to baseWeeks (0 OT at baseline)
  const maxWeeks = otMode !== "none" ? baseWeeks : noOtMaxWeeks;
  const maxExtension = maxWeeks - baseWeeks;
  // Slider always shows full Sat/Sun range so both optimal flags are visible
  const sliderMinWeeks = getMinWeeks(baseWeeks, getOtCapacity("satSun"), hoursData, xerSchedule);

  const baseEndDate = new Date(startDate);
  baseEndDate.setDate(baseEndDate.getDate() + baseWeeks * 7 - 1); snapToSunday(baseEndDate);
  // Compute CPM effective weeks for the sidebar end date display
  const sidebarEffectiveWeeks = useMemo(() => {
    const hasCPM = xerSchedule && xerSchedule.activities && xerSchedule.activities.length > 0;
    if (hasCPM && adjustedWeeks !== baseWeeks) {
      const cpm = compressByCPM(xerSchedule, adjustedWeeks, baseWeeks, otMode);
      return cpm ? cpm.achievedWeeks : adjustedWeeks;
    }
    return adjustedWeeks;
  }, [xerSchedule, adjustedWeeks, baseWeeks, otMode]);
  const adjustedEndDate = new Date(startDate);
  adjustedEndDate.setDate(adjustedEndDate.getDate() + Math.round(sidebarEffectiveWeeks * 7) - 1); snapToSunday(adjustedEndDate);

  // Per-week time-based cost data, keyed by timeCost id
  // Default: flat weekly rate derived from setup for every week
  const [timeCostData, setTimeCostData] = useState(() => {
    const data = {};
    defaultTimeCosts.forEach((t) => {
      const weeklyRate = t.basis === "weekly" ? t.rate : t.rate / 4.33;
      data[t.id] = new Array(NUM_WEEKS).fill(Math.round(weeklyRate));
    });
    return data;
  });

  // Auto-load default XER schedule on first mount
  const xerLoadedRef = useRef(false);
  useEffect(() => {
    if (xerLoadedRef.current) return;
    xerLoadedRef.current = true;
    fetch("Pump House-1.xer")
      .then(r => { if (!r.ok) throw new Error("XER fetch failed"); return r.text(); })
      .then(text => {
        try {
          const result = processXER(text);
          setDisciplines(result.disciplines);
          setHoursData(result.hoursData);
          setBaseWeeks(result.baseWeeks);
          setStartDate(result.startDate);
          setWeekOffset(0);
          setDisciplinePFs({});
          setXerSchedule(result.schedule || null);
        } catch (e) {
          console.warn("Default XER parse failed, using hardcoded demo data:", e.message);
        }
      })
      .catch(e => {
        console.warn("Default XER load failed, using hardcoded demo data:", e.message);
      });
  }, []);

  // Re-sync timeCostData when timeCosts rates change (e.g. via Setup tab)
  useEffect(() => {
    setTimeCostData((prev) => {
      const next = {};
      timeCosts.forEach((t) => {
        const weeklyRate = t.basis === "weekly" ? t.rate : t.rate / 4.33;
        const rounded = Math.round(weeklyRate);
        // If this item existed before with same length, check if rate changed
        const existing = prev[t.id];
        if (existing && existing.length === baseWeeks && existing[0] === rounded) {
          next[t.id] = existing; // unchanged, keep any per-week edits
        } else {
          next[t.id] = new Array(baseWeeks).fill(rounded);
        }
      });
      return next;
    });
  }, [timeCosts, baseWeeks]);

  // Compute optimal duration for each OT scenario
  const optimalByOt = useMemo(() => {
    const weeklyTimeCostRate = timeCosts.reduce((s, t) => {
      if (t.basis === "weekly") return s + t.rate;
      if (t.basis === "monthly") return s + t.rate / 4.33;
      return s;
    }, 0);
    const discInfo = disciplines.map((d) => ({
      id: d.id, rate: d.rate, otRate: d.otRate,
      origHours: hoursData[d.id] || new Array(baseWeeks).fill(0),
      hrs: (hoursData[d.id] || []).reduce((ss, h) => ss + h, 0),
    }));
    const hasCPM = xerSchedule && xerSchedule.activities && xerSchedule.activities.length > 0;

    const results = {};
    for (const mode of ["sat", "satSun"]) {
      const cap = getOtCapacity(mode);
      const modeMinWeeks = getMinWeeks(baseWeeks, cap, hoursData, xerSchedule);
      let best = Infinity, bestW = baseWeeks;

      for (let w = modeMinWeeks; w <= baseWeeks; w++) {
        let cpmResult = null;
        if (hasCPM && w !== baseWeeks) cpmResult = compressByCPM(xerSchedule, w, baseWeeks, mode);
        const ew = cpmResult ? cpmResult.achievedWeeks : w;

        const pf = getNonLinearPF(ew, baseWeeks, cap, hoursData);
        const cpmAdj = cpmResult ? cpmResult.hoursData : null;
        const stackPenalties = computeStackingPenalties(hoursData, baseWeeks, ew, cpmAdj);
        const directCost = discInfo.reduce((s, di) => {
          const adjH = cpmResult ? (cpmResult.hoursData[di.id] || []) : null;
          return s + computeEnhancedCost(di.origHours, di.rate, di.otRate, mode, baseWeeks, ew, pf, stackPenalties, RISK_BANDS.P50, adjH);
        }, 0);
        const calW = ew;
        const timeCost = weeklyTimeCostRate * calW;
        const total = directCost + timeCost;
        if (total < best) { best = total; bestW = w; }
      }

      const calW = bestW;
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + Math.round(calW * 7) - 1); snapToSunday(endDate);
      results[mode] = {
        weeks: bestW,
        offset: bestW - baseWeeks,
        calWeeks: Math.round(calW),
        cost: best,
        endDate: endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };
    }
    return results;
  }, [disciplines, hoursData, timeCosts, baseWeeks, maxWeeks, startDate, xerSchedule]);

  // Update body background when theme changes
  useEffect(() => {
    document.body.style.background = COLORS.bg;
  }, [theme, COLORS.bg]);

  return (
    <ThemeContext.Provider value={theme}>
    <div style={styles.container}>
      <style>{getSliderCSS(COLORS)}</style>

      {/* Left Sidebar */}
      <nav className="crunch-sidebar" style={styles.sidebar} aria-label="Main navigation">
        <div style={{ padding: "0 16px", height: 52, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8, display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 5,
              background: `${COLORS.accent}18`,
              border: `2px solid ${COLORS.accent}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                <rect x="6" y="2" width="20" height="2" rx="1" fill={COLORS.accent}/>
                <rect x="6" y="28" width="20" height="2" rx="1" fill={COLORS.accent}/>
                <path d="M8 4L8 8Q8 12 13 15.5L15 17L17 17L19 15.5Q24 12 24 8L24 4" stroke={COLORS.accent} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
                <path d="M8 28L8 24Q8 20 13 16.5L15 15L17 15L19 16.5Q24 20 24 24L24 28" stroke={COLORS.accent} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
                <path d="M10 7Q10 10 14 13L16 14.5L18 13Q22 10 22 7L22 5L10 5Z" fill={COLORS.accent} opacity="0.3"/>
                <path d="M10 27L10 25Q10 22 14 19L16 17.5L18 19Q22 22 22 25L22 27Z" fill={COLORS.accent} opacity="0.5"/>
                <rect x="15.25" y="14.5" width="1.5" height="3" rx="0.75" fill={COLORS.accent} opacity="0.7"/>
                <polyline points="2,14.5 4.5,16 2,17.5" stroke={COLORS.accent} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <polyline points="30,14.5 27.5,16 30,17.5" stroke={COLORS.accent} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>
            <div className="sidebar-brand-text">
              <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: COLORS.text, lineHeight: 1.1 }}>CRUNCH</div>
            </div>
          </div>
        </div>
        <div style={styles.tabs} role="tablist" aria-label="Main sections">
          {[
            { key: "forecast", label: "EAC Forecast", icon: "◈" },
            { key: "adjustments", label: "Adjustments", icon: "⚙" },
            { key: "data", label: "Data", icon: "▤" },
            { key: "hours", label: "Schedule & Hours", icon: "⏱" },
            { key: "setup", label: "Setup", icon: "◧" },
            { key: "models", label: "Models", icon: "ƒ" },
          ].map((t) => (
            <button key={t.key} role="tab" aria-selected={activeTab === t.key} aria-controls={`panel-${t.key}`} className="nav-tab" style={{ ...styles.tab(activeTab === t.key), border: "none", background: styles.tab(activeTab === t.key).background, display: "flex", alignItems: "center", cursor: "pointer", width: "100%" }} onClick={() => setActiveTab(t.key)}>
              <span style={{ fontSize: 12, opacity: 0.7, marginRight: 8, flexShrink: 0 }}>{t.icon}</span><span className="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile Tab Bar — visible only on small screens */}
      <div className="crunch-mobile-tabs" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, display: "none", justifyContent: "space-around", padding: "6px 0" }}>
        {[
          { key: "forecast", icon: "◈" },
          { key: "adjustments", icon: "⚙" },
          { key: "data", icon: "▤" },
          { key: "hours", icon: "⏱" },
          { key: "setup", icon: "◧" },
          { key: "models", icon: "ƒ" },
        ].map((t) => (
          <button key={t.key} role="tab" aria-selected={activeTab === t.key} onClick={() => setActiveTab(t.key)} style={{ background: "none", border: "none", color: activeTab === t.key ? COLORS.accent : COLORS.textDim, fontSize: 18, cursor: "pointer", padding: "4px 8px", opacity: activeTab === t.key ? 1 : 0.6 }} aria-label={t.key}>{t.icon}</button>
        ))}
      </div>

      {/* Main Content */}
      <div style={styles.mainContent}>
        <div style={styles.header}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => {
              if (activeTab !== "forecast") {
                pendingExport.current = true;
                setActiveTab("forecast");
                return;
              }
              if (exportRef.current) {
                exportRef.current();
              } else {
                // Ref not yet set — retry after React render cycle
                setTimeout(() => {
                  if (exportRef.current) exportRef.current();
                }, 200);
              }
            }}
            aria-label="Export CRUNCH report"
            style={{
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: FONT,
              fontWeight: 500,
              color: COLORS.textDim,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Export CRUNCH report"
          >
            <span style={{ fontSize: 14 }}>⎙</span> Export Report
          </button>
          <div style={{ width: 1, height: 30, background: COLORS.border }} />
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            style={{
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: FONT,
              color: COLORS.textDim,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {theme === "dark" ? "☀" : "☾"} {theme === "dark" ? "Light" : "Dark"}
          </button>
          <div style={{ width: 1, height: 30, background: COLORS.border }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>Base Duration</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{baseWeeks} Weeks</div>
          </div>
          <div style={{ width: 1, height: 30, background: COLORS.border }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>Disciplines</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{disciplines.length}</div>
          </div>
        </div>
      </div>

      {/* Schedule Duration Adjustment — above all tabs (hidden on Models tab) */}
      <div ref={sliderSentinelRef} style={{ padding: "0 28px", marginBottom: 0, display: activeTab === "models" ? "none" : "block" }}>

      {/* Compact sticky slider bar */}
      {sliderSticky && activeTab !== "models" && (
        <div className="crunch-sticky-bar" style={{
          position: "fixed",
          top: 0,
          left: SIDEBAR_WIDTH,
          right: 0,
          zIndex: 100,
          background: COLORS.surface,
          borderBottom: `1px solid ${COLORS.border}`,
          padding: "8px 28px 10px",
          boxShadow: `0 2px 12px ${COLORS.bg}88`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type="range"
                aria-label="Schedule duration adjustment"
                style={styles.slider}
                min={sliderMinWeeks - baseWeeks}
                max={otMode !== "none" ? 0 : noOtMaxWeeks - baseWeeks}
                value={weekOffset}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setWeekOffset(Math.max(v, minWeeks - baseWeeks));
                }}
              />
              <DiamondMarkers optimalByOt={optimalByOt} otMode={otMode} sliderMinWeeks={sliderMinWeeks} baseWeeks={baseWeeks} noOtMaxWeeks={noOtMaxWeeks} size={7} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.accent, whiteSpace: "nowrap", minWidth: 90, textAlign: "center" }}>
              {weekOffset === 0 ? "Baseline" : `${weekOffset > 0 ? "+" : ""}${weekOffset} wks`}
              {otMode !== "none" && weekOffset < 0 ? ` · ${getOtWeeks(adjustedWeeks, baseWeeks, otMode)} OT` : ""}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim, whiteSpace: "nowrap" }}>
              {adjustedEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <OtModeButtons otMode={otMode} setOtMode={setOtMode} weekOffset={weekOffset} setWeekOffset={setWeekOffset} baseWeeks={baseWeeks} hoursData={hoursData} xerSchedule={xerSchedule} compact={true} />
            <OtScopeToggle otScope={otScope} setOtScope={setOtScope} compact={true} disabled={otMode === "none"} />
          </div>
        </div>
      )}
        <div style={{ ...styles.card, borderColor: COLORS.accentDim, background: `linear-gradient(135deg, ${COLORS.surface}, ${COLORS.surfaceAlt})`, marginBottom: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={styles.cardTitle}>Schedule Duration Adjustment</div>
              <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: -8 }}>
                {otMode !== "none"
                  ? "Drag left to progressively add overtime"
                  : "Drag the slider to extend or compress the project schedule"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Overtime</div>
                <OtModeButtons otMode={otMode} setOtMode={setOtMode} weekOffset={weekOffset} setWeekOffset={setWeekOffset} baseWeeks={baseWeeks} hoursData={hoursData} xerSchedule={xerSchedule} />
                <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>Progressive — slide to add OT</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>OT Scope</div>
                <OtScopeToggle otScope={otScope} setOtScope={setOtScope} disabled={otMode === "none"} />
                <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>{otMode === "none" ? "Enable OT to configure" : otScope === "zone" ? "All disciplines work OT" : "Only compressed tasks"}</div>
              </div>
            </div>
          </div>


          {/* Slider */}
          <div style={{ padding: "0 4px", marginTop: 12 }}>
            <div style={{ position: "relative" }}>
              <input
                type="range"
                aria-label="Schedule duration adjustment"
                aria-valuetext={weekOffset === 0 ? "Baseline" : `${weekOffset} weeks`}
                style={styles.slider}
                min={sliderMinWeeks - baseWeeks}
                max={otMode !== "none" ? 0 : noOtMaxWeeks - baseWeeks}
                value={weekOffset}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setWeekOffset(Math.max(v, minWeeks - baseWeeks));
                }}
              />
              <DiamondMarkers optimalByOt={optimalByOt} otMode={otMode} sliderMinWeeks={sliderMinWeeks} baseWeeks={baseWeeks} noOtMaxWeeks={noOtMaxWeeks} size={8} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontSize: 11, color: otMode === "none" ? COLORS.textMuted : COLORS.green }}>
                {otMode === "none" ? "← Enable OT to accelerate" : `← Max OT (${minWeeks} wks)`}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: weekOffset === 0 && otMode === "none" ? COLORS.textDim : COLORS.accent }}>
                  {weekOffset === 0 ? "Baseline" : `${weekOffset > 0 ? "+" : ""}${weekOffset} weeks`}
                  {otMode !== "none" && weekOffset < 0 ? ` · ${getOtWeeks(adjustedWeeks, baseWeeks, otMode)} OT wks` : ""}
                </span>
                {(weekOffset !== 0 || otMode !== "none") && (
                  <button
                    aria-label="Reset schedule to baseline"
                    onClick={() => { setWeekOffset(0); setOtMode("none"); }}
                    style={{
                      background: "transparent", border: `1px solid ${COLORS.border}`,
                      color: COLORS.textDim, fontSize: 10, fontWeight: 600, fontFamily: FONT,
                      padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
              <span style={{ fontSize: 11, color: otMode !== "none" ? COLORS.textDim : COLORS.red }}>
                {otMode !== "none" ? `Baseline (${baseWeeks} wks) →` : `Extend (${noOtMaxWeeks} wks) →`}
              </span>
            </div>
          </div>

          {/* Metrics row */}
          <div style={{ display: "flex", gap: 20, marginTop: 20, justifyContent: "center", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>Base End</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textDim }}>{baseEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
              <div style={{ fontSize: 11, color: COLORS.textDim }}>{baseWeeks} weeks</div>
            </div>
            <div style={{ width: 1, background: COLORS.border }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: COLORS.accent, textTransform: "uppercase" }}>Adjusted End</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.accent }}>{adjustedEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
              <div style={{ fontSize: 11, color: COLORS.accent }}>
                {Math.round(calendarWeeks)} weeks
              </div>
            </div>
            <div style={{ width: 1, background: COLORS.border }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>
                {otMode !== "none" && weekOffset < 0 ? "OT Schedule" : "Schedule Δ"}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: Math.round(calendarWeeks) === baseWeeks ? COLORS.textDim : Math.round(calendarWeeks) < baseWeeks ? COLORS.green : COLORS.red }}>
                {Math.round(calendarWeeks) === baseWeeks ? "—" : `${Math.round(calendarWeeks) - baseWeeks} weeks`}
              </div>
              {otMode !== "none" && weekOffset < 0 && (
                <div style={{ fontSize: 11, color: COLORS.orange }}>
                  {getOtWeeks(adjustedWeeks, baseWeeks, otMode)} of {adjustedWeeks} wks OT ({Math.round(getOtUtilization(adjustedWeeks, baseWeeks, otMode) * 100)}%)
                </div>
              )}
              {otMode !== "none" && weekOffset === 0 && (
                <div style={{ fontSize: 11, color: COLORS.textDim }}>No OT at baseline</div>
              )}
            </div>
          </div>

          {/* Optimal OT scenario cards */}
          <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { mode: "sat", label: "Sat OT Optimal", color: COLORS.orange, data: optimalByOt.sat },
              { mode: "satSun", label: "Sat+Sun OT Optimal", color: "#fbbf24", data: optimalByOt.satSun },
            ].map((f) => {
              const isActive = otMode === f.mode && weekOffset === f.data.offset;
              return (
                <button
                  key={f.mode}
                  onClick={() => { setOtMode(f.mode); setWeekOffset(f.data.offset); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                    background: isActive ? f.color + "15" : COLORS.surface,
                    border: `1px solid ${isActive ? f.color : COLORS.border}`,
                    borderRadius: 6, padding: "8px 14px", cursor: "pointer",
                    fontFamily: FONT, transition: "all 0.15s",
                    outline: isActive ? `1px solid ${f.color}44` : "none",
                    outlineOffset: 2,
                  }}
                >
                  <div style={{ fontSize: 18, lineHeight: 1, color: f.color }}>★</div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: f.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, fontFamily: DISPLAY_FONT, marginTop: 1 }}>
                      {f.data.calWeeks} wks · {f.data.endDate}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>
                      {formatCurrency(f.data.cost)} EAC{f.data.calWeeks < baseWeeks ? ` · ${baseWeeks - f.data.calWeeks} wks saved` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={styles.body} role="tabpanel" id={`panel-${activeTab}`} aria-label={activeTab} aria-live="polite">
        {activeTab === "setup" && <SetupTab disciplines={disciplines} setDisciplines={setDisciplines} timeCosts={timeCosts} setTimeCosts={setTimeCosts} />}
        {activeTab === "hours" && <HoursTab disciplines={disciplines} setDisciplines={setDisciplines} hoursData={hoursData} setHoursData={setHoursData} baseWeeks={baseWeeks} setBaseWeeks={setBaseWeeks} startDate={startDate} setStartDate={setStartDate} setWeekOffset={setWeekOffset} setDisciplinePFs={setDisciplinePFs} xerSchedule={xerSchedule} setXerSchedule={setXerSchedule} />}
        {activeTab === "data" && <DataTab disciplines={disciplines} hoursData={hoursData} timeCosts={timeCosts} timeCostData={timeCostData} baseWeeks={baseWeeks} startDate={startDate} />}
        {activeTab === "adjustments" && <AdjustmentsTab disciplines={disciplines} hoursData={hoursData} timeCosts={timeCosts} timeCostData={timeCostData} baseWeeks={baseWeeks} startDate={startDate} weekOffset={weekOffset} otMode={otMode} disciplinePFs={disciplinePFs} setDisciplinePFs={setDisciplinePFs} xerSchedule={xerSchedule} />}
        {activeTab === "forecast" && <ForecastTab disciplines={disciplines} hoursData={hoursData} timeCosts={timeCosts} baseWeeks={baseWeeks} startDate={startDate} weekOffset={weekOffset} setWeekOffset={setWeekOffset} otMode={otMode} otScope={otScope} disciplinePFs={disciplinePFs} exportRef={exportRef} pendingExport={pendingExport} xerSchedule={xerSchedule} />}
        {activeTab === "models" && <ModelsTab baseWeeks={baseWeeks} hoursData={hoursData} disciplines={disciplines} xerSchedule={xerSchedule} />}
      </div>
      </div>{/* end mainContent */}
    </div>
    </ThemeContext.Provider>
  );
}

// Auto-mount when loaded in browser via Babel standalone (index.html dev loader)
if (typeof window !== "undefined" && typeof ReactDOM !== "undefined" && document.getElementById("root")) {
  const _root = ReactDOM.createRoot(document.getElementById("root"));
  _root.render(_React.createElement(CostForecastApp));
}
