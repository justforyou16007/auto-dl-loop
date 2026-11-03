/**
 * The two profiles of the research task, as its own helpers need them: the
 * worker builds and submits, the validator reviews and publishes. The framework
 * learns them from project.json; these helpers are the project's own code.
 */
export type ResearchSide = "worker" | "validator";

/** The entry role of each side: a session opened in the project runs as it. */
export const TASK_MANAGER: Record<ResearchSide, string> = {
  worker: "worker-task-manager",
  validator: "validator-task-manager",
};
/** The role that configures each side's machine with the owner. */
export const CONFIG_ROLE: Record<ResearchSide, string> = {
  worker: "worker-config",
  validator: "validator-config",
};

export function researchSide(role: string): ResearchSide {
  if (role !== "worker" && role !== "validator")
    throw new Error(`this helper serves the research task's worker or validator, not ${role}`);
  return role;
}
