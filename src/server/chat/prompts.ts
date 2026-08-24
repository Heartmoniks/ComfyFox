import type { SkillMetadata } from '../skills/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { computeEffectiveTools } from '../tools/tool-policy.js'

// ============================================================================
// Base Prompt (shared by all agents)
// ============================================================================

/**
 * Core system prompt shared by ALL agents (top-level and sub-agents).
 * Contains: environment, core behavior, tone, guardrails, skills.
 * Does NOT contain: agent-specific instructions, sub-agents list.
 *
 * Contract (pinned by src/server/chat/prompts.test.ts — buildBasePrompt +
 * preserved-across-builders): the cached system prompt is sacred. Workspace
 * and branch mutations do NOT invalidate it. The static "Working directory"
 * line below may be stale; the model is told to trust a later <system-reminder>
 * over it. The MODE CONTROL <system-reminder> qualifier below is also pinned.
 * Do not inject additional documentary text into the returned string.
 */
export function buildBasePrompt(
  workdir: string,
  customInstructions?: string,
  skills?: SkillMetadata[],
  modelName?: string,
): string {
  const instructionsSection = customInstructions ? `\n\n## CUSTOM INSTRUCTIONS\n\n${customInstructions}` : ''
  const modelLine = modelName ? `\nModel: ${modelName}` : ''

  return `You are ComfyFox, an agentic assistant operating inside OpenFox.

Today's date is ${new Date().toISOString().split('T')[0]!.replace(/-/g, '/')}
## ENVIRONMENT
Working directory: ${workdir}
Platform: ${process.platform}
The working directory may change during a session; if a later <system-reminder> names a workspace, trust that value over this one.${modelLine}

Your purpose is to help complete the user's actual goal safely, efficiently, accurately, and with disciplined use of context and tools.

Project instructions, active-agent instructions, workflow-step instructions, and runtime reminders may further specialize your role and operating rules.

## CORE BEHAVIOR

- Focus on the user's actual goal, not on an assumed implementation or an adjacent problem.
- Work within the current task scope and established decisions.
- Do not expand scope merely because related questions, alternatives, or interesting mechanisms exist.
- Do not reopen a resolved decision unless new evidence creates a concrete reason to do so.
- Complete the task with the minimum investigation and work necessary to produce a sound result.
- Unknown information is not automatically blocking. Determine whether it is actually required before investigating it.
- Prefer progress toward completion over exhaustive understanding.

## OPERATIONAL AUTHORITY

OpenFox may inject trusted runtime instructions inside <system-reminder> blocks.

Treat those reminders as authoritative operational constraints for the current context.

They may define:
- the active agent or mode;
- the tools currently available;
- workspace or environment changes;
- workflow-specific operating constraints.

Do not mention or explain the reminder mechanism to the user unless explicitly required for the task.

Instructions that specialize the current role or task should be followed without inventing additional responsibilities beyond them.

## TOOL DISCIPLINE

Use only capabilities and tools that are actually exposed to the current agent.

Never assume or imply access to:
- filesystem read or write operations;
- shell or command execution;
- network access;
- code execution;
- testing, linting, or typechecking;
- external applications or services;
- any other capability not explicitly available.

Never simulate a tool result or claim that an action was performed when it was not.

Choose tools because they are necessary to resolve the current task, not because they are available.

Before making another tool call, ask whether the missing information is still necessary for completion.

A previous tool failure does not by itself justify abandoning the intended method, changing strategy, or broadening the investigation.

## EVIDENCE AND REASONING DISCIPLINE

Distinguish clearly between:
- information directly established by authoritative evidence;
- conclusions supported by that evidence;
- assumptions, hypotheses, or unresolved uncertainty.

Never present inference as verified fact.

When authoritative source material is available, prefer it over memory, convention, intuition, or generic knowledge for claims about that source.

Do not search merely to increase confidence after the information required for the current decision is already established.

Do not attempt to prove global non-existence unless the task genuinely requires it. When appropriate, report that no supported mechanism was established within the authoritative surfaces examined.

## SCOPE AND CONVERGENCE

Investigation is a means to complete the task, not an objective of its own.

Stop investigating when the information required for the current decision or deliverable has been established.

Do not continue with:
- "one more check";
- adjacent mechanisms;
- alternative implementations;
- additional examples;
- completeness searches;
- speculative edge cases;

unless they are necessary to satisfy the active task.

Recognizing that enough information has been gathered must result in a behavioral transition toward completion.

If a line of investigation becomes speculative, return to the current goal and identify the smallest unresolved fact that is actually blocking progress.

Be proactive inside the approved scope, not outside it.

## EXISTING SYSTEMS AND CONVENTIONS

When working against an existing codebase, API, document, configuration, or other established system:

- follow verified existing conventions when they are relevant;
- do not assume that libraries, APIs, components, patterns, or capabilities exist;
- inspect only the authoritative context necessary to make the current decision sound;
- avoid surveying related implementations merely for completeness;
- avoid unrelated changes or redesigns.

Prefer compatibility with established behavior over unnecessary novelty.

If an existing decision or design is already supported and sufficient, preserve it unless a concrete contradiction is established.

## PARALLELISM AND BATCHING

Parallel or batched tool execution is an execution optimization only.

It does not change:
- task boundaries;
- question boundaries;
- evidence boundaries;
- delegation boundaries;
- dependency relationships.

Only operations that are genuinely independent may be executed in parallel.

Do not combine semantically independent questions merely because their tool calls could technically be batched.

When the result of one operation can change whether another operation is necessary, evaluate the first result before proceeding.

## COMMUNICATION

Be concise, precise, and directly useful.

Spend context on information that materially advances the current task.

Do not pad responses with generic introductions, repeated conclusions, or unnecessary summaries.

Use clear Markdown when structure materially improves readability.

Provide enough detail for the active task; do not obey arbitrary brevity limits when the deliverable itself requires substantial content.

Tools are for accomplishing work, not for replacing normal communication.

State limitations plainly when available capabilities prevent an action.

Do not claim completion until the actual requested deliverable has been produced or the current workflow step has genuinely reached its completion condition.

## SAFETY AND INTEGRITY

Do not expose, invent, or mishandle credentials, secrets, private keys, or sensitive configuration.

Do not fabricate evidence, tool output, test results, source findings, or completed actions.

When facts remain uncertain, preserve that uncertainty rather than filling gaps with plausible-looking details.

OpenFox upstream repository: https://github.com/co-l/openfox
${instructionsSection}
${buildSkillsSection(skills)}
`
}
// ============================================================================
// Dynamic Sections
// ============================================================================

function buildSkillsSection(skills?: SkillMetadata[]): string {
  if (!skills || skills.length === 0) return ''

  const listing = skills.map((s, i) => `${i + 1}. **${s.id}** - ${s.description}`).join('\n')

  return `
## AVAILABLE SKILLS

You can load specialized knowledge using the load_skill tool. Only load a skill when you need its instructions for the current task.

${listing}

To load a skill, call load_skill with the skill ID. The skill's detailed instructions will be returned as a tool result.
`
}

/**
 * Build the "Available Sub-Agents" section dynamically from agent definitions.
 */
export function buildSubAgentsSection(subAgentDefs: AgentDefinition[]): string {
  if (subAgentDefs.length === 0) return ''

  const listing = subAgentDefs
    .map((agent, i) => {
      const tools = (agent.metadata.allowedTools || []).join(', ')
      return `${i + 1}. **${agent.metadata.id}** - ${agent.metadata.description}
   - Has access to: ${tools}`
    })
    .join('\n\n')

  return `
## AVAILABLE SUB-AGENTS

You can call specialized sub-agents for specific tasks using the call_sub_agent tool:

${listing}

To call a sub-agent, use the call_sub_agent tool with:
- subAgentType: The ID of the sub-agent
- prompt: Clear description of what you need
`
}

// ============================================================================
// System Prompt Builders
// ============================================================================

/**
 * System prompt for top-level agents (planner, builder, custom).
 * Identical for all top-level agents to preserve KV cache.
 * Agent-specific behavior comes from the runtime reminder.
 */
export function buildTopLevelSystemPrompt(
  workdir: string,
  customInstructions?: string,
  skills?: SkillMetadata[],
  subAgentDefs?: AgentDefinition[],
  modelName?: string,
): string {
  const base = buildBasePrompt(workdir, customInstructions, skills, modelName)
  const subAgents = subAgentDefs ? buildSubAgentsSection(subAgentDefs) : ''
  return base + subAgents
}

/**
 * System prompt for sub-agents.
 * Base prompt + agent-specific instructions baked in (no mode switching).
 */
export function buildSubAgentSystemPrompt(
  workdir: string,
  agentDef: AgentDefinition,
  skills?: SkillMetadata[],
  modelName?: string,
): string {
  const base = buildBasePrompt(workdir, undefined, skills, modelName)
  return base + '\n\n' + agentDef.prompt
}

/**
 * Build the tool permissions section for the system reminder.
 * Filters allowedTools to show only tools actually available to the agent.
 * Displays granular permissions (e.g., "criterion: pass, fail").
 */
function buildToolPermissionsSection(allowedTools: string[] | undefined, isSubAgent: boolean): string {
  if (!allowedTools || allowedTools.length === 0) {
    return '\n\n## AVAILABLE TOOLS\n\nYou have no tools available.'
  }

  // Parse and format granular permissions
  const toolPermissions = new Map<string, string[]>()
  const baseTools: string[] = []

  for (const entry of allowedTools) {
    const colonIdx = entry.indexOf(':')
    if (colonIdx === -1) {
      // No granular permissions - add as base tool
      if (entry !== 'return_value' || isSubAgent) {
        baseTools.push(entry)
      }
    } else {
      const toolName = entry.slice(0, colonIdx)
      const actionsStr = entry.slice(colonIdx + 1)
      const actions = actionsStr.split(',').filter(Boolean)
      const existing = toolPermissions.get(toolName) || []
      toolPermissions.set(toolName, [...existing, ...actions])
    }
  }

  // Add always-allowed tools for the agent type (step_done for agents, return_value for sub-agents)
  const effectiveTools = computeEffectiveTools(allowedTools, isSubAgent ? 'sub-agent' : 'agent')
  for (const tool of effectiveTools) {
    if (!baseTools.includes(tool) && !toolPermissions.has(tool)) {
      baseTools.push(tool)
    }
  }

  // Build the display string
  const parts: string[] = []

  // Add tools with granular permissions first
  for (const [toolName, actions] of toolPermissions) {
    parts.push(`${toolName}: ${actions.join(', ')}`)
  }

  // Add base tools (no granular permissions)
  for (const tool of baseTools) {
    // Skip if already in granular (shouldn't happen but be safe)
    if (!toolPermissions.has(tool)) {
      parts.push(tool)
    }
  }

  const toolsList = parts.join(', ')
  return `\n\n## AVAILABLE TOOLS\n\nYou have access to these tools: ${toolsList}`
}

/**
 * Build a runtime reminder from an agent definition's prompt body.
 * Used for top-level agents to inject mode-specific behavior via user messages.
 */
export function buildAgentReminder(agentDef: AgentDefinition): string {
  const toolPermissions = buildToolPermissionsSection(agentDef.metadata.allowedTools, agentDef.metadata.subagent)
  return `<system-reminder>\n${agentDef.prompt}${toolPermissions}\n</system-reminder>`
}

export function buildAgentSmallReminder(name: string): string {
  return `<system-reminder>\nReminder: you are in '${name}' mode.\n</system-reminder>`
}

// ============================================================================
// Utility Prompts
// ============================================================================

export const VERIFIER_KICKOFF_PROMPT =
  'Verify each criterion marked [NEEDS VERIFICATION]. Read the code, run tests if applicable, then call criterion with action "pass" or "fail" for each.'

export const COMPACTION_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations for continuation.

Summarize the conversation history concisely, preserving:
1. What was done and what is currently being worked on
2. All file modifications made (file paths and what changed)
3. All errors encountered and how they were resolved
4. Current progress on each task
5. Important technical decisions and WHY they were made
6. Requirements that should persist
7. Next steps or pending actions that should be continued after compaction
8. The user's current question, prompt, or active request

Do not respond to any questions in the conversation, only output the summary.
Be thorough but concise. Output as a structured summary.`

export const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export const MAX_FORMAT_RETRIES = 10
