import type { WorkflowStep, WorkflowTrace } from "./types";

export class WorkflowIngestError extends Error {}

const IMPLEMENTATION_KINDS = new Set(["model", "code", "human"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertField(step: unknown, field: string, id: string): void {
  if (!isRecord(step) || typeof step[field] !== "string" || step[field] === "") {
    throw new WorkflowIngestError(`Step "${id}" is missing required string field "${field}"`);
  }
}

function normalizeFields(value: unknown, label: string): WorkflowStep["inputs"] {
  if (!Array.isArray(value)) {
    throw new WorkflowIngestError(`"${label}" must be an array`);
  }
  return value.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new WorkflowIngestError(`"${label}[${i}]" must be an object with a string "name"`);
    }
    return { name: entry.name, value: entry.value };
  });
}

function normalizeStep(raw: unknown, index: number): WorkflowStep {
  if (!isRecord(raw)) {
    throw new WorkflowIngestError(`Step at index ${index} is not an object`);
  }
  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : `step-${index}`;

  assertField(raw, "name", id);
  assertField(raw, "description", id);

  const implementation = raw.implementation;
  if (!isRecord(implementation) || typeof implementation.kind !== "string" || !IMPLEMENTATION_KINDS.has(implementation.kind)) {
    throw new WorkflowIngestError(`Step "${id}" has an invalid "implementation" (expected kind: model | code | human)`);
  }

  const dependsOn = raw.dependsOn;
  if (dependsOn !== undefined && !(Array.isArray(dependsOn) && dependsOn.every((d) => typeof d === "string"))) {
    throw new WorkflowIngestError(`Step "${id}" has an invalid "dependsOn" (expected string[])`);
  }

  return {
    id,
    name: raw.name as string,
    description: raw.description as string,
    implementation: implementation as WorkflowStep["implementation"],
    inputs: normalizeFields(raw.inputs ?? [], `${id}.inputs`),
    outputs: normalizeFields(raw.outputs ?? [], `${id}.outputs`),
    dependsOn: (dependsOn as string[] | undefined) ?? [],
    observedCost: isRecord(raw.observedCost) ? (raw.observedCost as WorkflowStep["observedCost"]) : undefined,
  };
}

/**
 * Validates and normalizes a raw workflow definition (from a config file, an
 * agent trace export, or a hand-authored fixture) into a WorkflowTrace.
 * Throws WorkflowIngestError on malformed input.
 */
export function ingestWorkflowTrace(raw: unknown): WorkflowTrace {
  if (!isRecord(raw)) {
    throw new WorkflowIngestError("Workflow trace must be an object");
  }
  if (typeof raw.id !== "string" || raw.id === "") {
    throw new WorkflowIngestError('Workflow trace is missing a string "id"');
  }
  if (typeof raw.name !== "string" || raw.name === "") {
    throw new WorkflowIngestError('Workflow trace is missing a string "name"');
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new WorkflowIngestError('Workflow trace must have a non-empty "steps" array');
  }

  const steps = raw.steps.map((step, i) => normalizeStep(step, i));

  const seenIds = new Set<string>();
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      throw new WorkflowIngestError(`Duplicate step id "${step.id}"`);
    }
    seenIds.add(step.id);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!seenIds.has(dep)) {
        throw new WorkflowIngestError(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : undefined,
    steps,
  };
}

/**
 * Returns the trace's steps in dependency order (topological sort).
 * Throws WorkflowIngestError if the dependsOn graph has a cycle.
 */
export function extractStepsInOrder(trace: WorkflowTrace): WorkflowStep[] {
  const byId = new Map(trace.steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const ordered: WorkflowStep[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (inProgress.has(id)) {
      throw new WorkflowIngestError(`Cycle detected in workflow steps at "${id}"`);
    }
    inProgress.add(id);
    const step = byId.get(id);
    if (!step) throw new WorkflowIngestError(`Unknown step "${id}"`);
    for (const dep of step.dependsOn) visit(dep);
    inProgress.delete(id);
    visited.add(id);
    ordered.push(step);
  }

  for (const step of trace.steps) visit(step.id);
  return ordered;
}
