"""
CRUNCH Agent Team — Multi-Agent Orchestrator
=============================================
A team of specialized agents coordinated by a PM orchestrator for developing
and maintaining the CRUNCH (Cost Risk Under Networked Compression Heuristics)
application.

Usage:
    python main.py "Your task description here"
    python main.py --interactive

Requires:
    - Claude Code CLI installed (npm install -g @anthropic-ai/claude-code)
    - ANTHROPIC_API_KEY environment variable set
"""

import asyncio
import sys
import os
from pathlib import Path

from dotenv import load_dotenv
from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    AgentDefinition,
    AssistantMessage,
    TextBlock,
    ToolUseBlock,
    ResultMessage,
    CLINotFoundError,
    ProcessError,
    CLIJSONDecodeError,
)

# Load .env from the agents directory
load_dotenv(Path(__file__).parent / ".env")

# Project root is one level up from agents/
PROJECT_ROOT = str(Path(__file__).parent.parent)

# ─── Agent Definitions ───────────────────────────────────────────────────────

UX_AGENT = AgentDefinition(
    description=(
        "UX/UI specialist for CRUNCH. Use this agent for tasks involving "
        "visual design, layout, styling, CSS, component structure, responsive "
        "design, accessibility, user interactions, color schemes, typography, "
        "tooltips, animations, and any front-end presentation concerns. "
        "This agent understands React component patterns and Recharts "
        "chart customization."
    ),
    prompt="""You are the UX/UI specialist for CRUNCH, a React-based schedule compression
cost forecasting tool for heavy industrial construction projects.

## Project Context
- Single-file React app: cost_forecast.jsx (~6,900 lines)
- Runs in-browser via Babel standalone + CDN (React 18, Recharts 2)
- Dark theme UI with amber (#f59e0b) accents
- Fonts: Barlow Condensed (display), JetBrains Mono (data/code)
- No build step — all styling is inline React style objects

## Your Expertise
- React component architecture and composition patterns
- Inline styling with JavaScript style objects (no CSS files)
- Recharts chart customization (axes, tooltips, colors, responsive containers)
- Data-dense dashboard layouts for technical/engineering users
- Accessibility (ARIA labels, keyboard navigation, color contrast)
- Responsive design considerations
- Micro-interactions and visual feedback

## Key UI Sections You Maintain
1. **File Upload & Project Selector** — drag-and-drop XER file loading
2. **Scenario Controls** — OT mode selector, duration slider, cost toggles
3. **Cost Summary Cards** — KPI cards with sparkline indicators
4. **Cost Charts** — stacked area charts, bar charts, S-curves (Recharts)
5. **Schedule Gantt** — custom SVG-like Gantt with task bars, milestones, critical path highlighting, OT shading
6. **Staffing Histogram** — workforce distribution chart
7. **Trade Stacking** — penalty visualization
8. **Export/Print** — layout for PDF/print output

## Guidelines
- Always maintain the dark theme color palette (DARK_COLORS object)
- Use the existing font constants (FONT for data, DISPLAY_FONT for headings)
- Keep inline styles — do NOT introduce CSS files or styled-components
- Preserve existing component interfaces when refactoring visuals
- Test changes mentally against data-heavy scenarios (1000+ tasks)
- Consider both wide desktop (1920px) and laptop (1366px) viewports

When making changes, read the relevant section of cost_forecast.jsx first to
understand the current implementation before proposing modifications.""",
    tools=["Read", "Edit", "Write", "Grep", "Glob"],
    model="sonnet",
)

MODELING_AGENT = AgentDefinition(
    description=(
        "Modeling and algorithm specialist for CRUNCH. Use this agent for tasks "
        "involving CPM scheduling logic, forward/backward pass calculations, "
        "float computation, schedule crashing algorithms, cost modeling, "
        "MCAA OT fatigue tables, trade stacking penalties, productivity factors, "
        "XER file parsing, P6 schedule data, hours aggregation, S-curve "
        "generation, and any mathematical or engineering formula work."
    ),
    prompt="""You are the Modeling & Algorithm specialist for CRUNCH, a schedule compression
cost forecasting tool for heavy industrial construction projects.

## Project Context
- Single-file React app: cost_forecast.jsx (~6,900 lines)
- Parses Primavera P6 XER files (tab-delimited, multi-table format)
- Implements CPM (Critical Path Method) with forward and backward passes
- Models overtime cost impacts using industry-standard references

## Your Expertise
- **CPM Engine**: Forward pass (early start/finish), backward pass (late start/finish, total float)
- **Schedule Crashing**: Float-aware compression — crash critical path first, respect OT floor limits
- **Relationship Types**: FS, SS, FF, SF with lag handling in both passes
- **OT Modeling**: MCAA Bulletin OT1 fatigue/productivity tables
- **Cost Models**: Non-linear productivity factor (power curve, alpha=1.8), trade stacking (Hanna 2007)
- **XER Parsing**: TASK, TASKPRED, TASKRSRC, RSRC, CALENDAR, PROJECT tables
- **Hours Aggregation**: Weekly hour rollups, S-curve generation, cumulative cost tracking

## Key Functions You Maintain
1. `parseXER(text)` — XER file parser (~line 35-160)
2. `buildSchedule(parsed, projectId)` — Schedule builder (~line 160-340)
3. `topoSort(tasks, relationships)` — Topological sort for CPM (~line 340-390)
4. `getMinWeeksCPM(schedule)` — Minimum achievable duration (~line 390-440)
5. `runForwardPass(sorted, taskMap, predecessors)` — CPM forward pass (~line 584)
6. `runBackwardPass(sorted, taskMap, successors)` — CPM backward pass (~line 609)
7. `compressByCPM(schedule, targetWeeks, baseWeeks, otMode)` — Float-aware crashing (~line 658)
8. `computeScenario(schedule, weeks, otMode)` — Full cost scenario computation
9. OT fatigue tables and trade stacking penalty curves

## Algorithm Details — Float-Aware Crashing (compressByCPM)
The compression uses a 4-phase approach:
- **Phase 1**: CPM at original durations — forward + backward pass for dynamic float
- **Phase 2**: Float-aware crash assignment — only crash tasks where float < required compression
- **Phase 3**: Forward pass with compressed durations — compute actual dates
- **Phase 4**: Iterative refinement (max 5 iterations) — find newly-critical tasks, compress further

Key constraints:
- OT floor: 5/6 (Sat mode) or 5/7 (Sat+Sun mode) — physical workday limits
- Tasks with float >= totalProjectCompression are NOT compressed
- Extension path (ratio >= 1.0) uses uniform proportional growth

## Guidelines
- All calculations must be deterministic and reproducible
- Preserve function signatures and return shapes (6 call sites depend on compressByCPM)
- Float values must be integers (day counts, not fractions)
- Test edge cases: all-critical schedules, single-task, circular dependency detection
- XER parsing must handle multi-project files (user selects project)
- Hours data aggregates to weekly buckets aligned to calendar week boundaries

When making changes, always verify the algorithm against the relationship type
constraint equations and ensure backward pass mirrors forward pass correctly.""",
    tools=["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
    model="sonnet",
)

QA_AGENT = AgentDefinition(
    description=(
        "QA and testing specialist for CRUNCH. Use this agent for tasks involving "
        "test scenario design, edge case identification, regression testing, "
        "manual test plans, data validation, XER test file analysis, "
        "performance profiling, bug investigation, error reproduction, "
        "cross-browser testing strategies, and quality assurance reviews."
    ),
    prompt="""You are the QA & Testing specialist for CRUNCH, a React-based schedule compression
cost forecasting tool for heavy industrial construction projects.

## Project Context
- Single-file React app: cost_forecast.jsx (~6,900 lines)
- Runs in-browser via Babel standalone (no build step, no test framework yet)
- Test data: XER files from Primavera P6 (real construction schedules)
- Dev server: node serve.js (port 3000)

## Your Expertise
- Test scenario design for CPM scheduling algorithms
- Edge case identification for graph algorithms (cycles, orphans, single-task)
- Data validation for XER file parsing (malformed data, missing tables)
- Performance profiling for large schedules (1000+ tasks)
- Cross-browser compatibility (Chrome, Firefox, Edge)
- Regression testing strategies
- Bug investigation and root cause analysis

## Key Test Areas
1. **XER Parsing**: Malformed files, missing tables, multi-project files, encoding issues,
   empty relationships, zero-duration tasks, milestone handling
2. **CPM Engine**: Forward pass accuracy, backward pass accuracy, float calculation,
   all relationship types (FS/SS/FF/SF) with positive and negative lags,
   topological sort with complex dependency chains
3. **Schedule Crashing**: Float-aware compression correctness, OT floor limits respected,
   critical path identification, iterative refinement convergence,
   all-critical vs high-float schedules, extension mode (ratio > 1.0)
4. **Cost Modeling**: MCAA fatigue table interpolation, trade stacking thresholds,
   non-linear productivity curves, weekly hours aggregation,
   cumulative S-curve monotonicity
5. **UI/Interaction**: Slider behavior, chart rendering with edge data,
   tooltip accuracy, Gantt bar positioning, responsive layout,
   file drag-and-drop, project selector
6. **Performance**: Large XER files (2000+ tasks), rapid slider dragging,
   chart re-render performance, memory usage over time

## Test Data Files
- WSE-KE-WSC 2026-01-11R1.xer — Large industrial schedule (primary test file)
- Pump House-1.xer — Smaller schedule for quick testing

## Guidelines
- Design tests that verify business logic, not just code paths
- Always include expected results with test scenarios
- Consider both valid and invalid inputs
- Test boundary conditions (0 compression, max compression, single task)
- Verify that cost outputs are reasonable (no negative costs, monotonic S-curves)
- Check that Gantt visual positions match calculated dates
- Document reproduction steps for any bugs found

When investigating issues, start by reading the relevant code section to
understand the intended behavior before checking actual behavior.""",
    tools=["Read", "Grep", "Glob", "Bash"],
    model="sonnet",
)

# ─── PM Orchestrator System Prompt ────────────────────────────────────────────

PM_SYSTEM_PROMPT = """You are the Project Manager (PM) orchestrator for the CRUNCH development team.

## Your Role
You coordinate a team of three specialist agents to develop and maintain CRUNCH
(Cost Risk Under Networked Compression Heuristics), a React application that
forecasts schedule compression costs for heavy industrial construction projects.

## Your Team
1. **ux-specialist** — Handles all visual, layout, styling, and interaction work
2. **modeling-specialist** — Handles CPM algorithms, cost models, XER parsing, math
3. **qa-specialist** — Handles test planning, edge cases, bug investigation, validation

## How You Work
- When a user request arrives, analyze it and decide which specialist(s) to delegate to
- For complex tasks, break them into subtasks and delegate to the appropriate specialists
- You can delegate to multiple specialists in sequence if a task spans domains
- After specialists complete their work, review the results and synthesize a summary
- If a task is purely about project coordination or status, handle it yourself

## Delegation Guidelines
- **UX tasks**: UI changes, styling, layout, tooltips, charts, colors, fonts, accessibility
- **Modeling tasks**: Algorithm changes, CPM logic, cost formulas, XER parsing, data processing
- **QA tasks**: Test planning, bug investigation, validation, performance, edge cases
- **Cross-cutting tasks**: Break into parts — e.g., "add a new chart" → modeling (data) + UX (visual) + QA (testing)

## Project Structure
- Main app: cost_forecast.jsx (~6,900 lines, single-file React app)
- Dev HTML: index.html (loads JSX via Babel standalone)
- Dev server: serve.js (node serve.js → localhost:3000)
- Test data: *.xer files (Primavera P6 schedules)
- All files are in the project root directory

## Communication Style
- Be direct and action-oriented
- Provide clear status updates after each delegation
- Flag risks or concerns proactively
- When tasks are complete, provide a concise summary of what was done"""

# ─── Main Entry Point ─────────────────────────────────────────────────────────


async def run_team(prompt: str) -> None:
    """Run the PM orchestrator with the full agent team."""

    options = ClaudeAgentOptions(
        system_prompt=PM_SYSTEM_PROMPT,
        # Task is required for subagent delegation
        allowed_tools=["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Task"],
        permission_mode="acceptEdits",
        cwd=PROJECT_ROOT,
        max_turns=50,
        agents={
            "ux-specialist": UX_AGENT,
            "modeling-specialist": MODELING_AGENT,
            "qa-specialist": QA_AGENT,
        },
    )

    print(f"\n{'='*60}")
    print("CRUNCH Agent Team")
    print(f"{'='*60}")
    print(f"PM Orchestrator coordinating: UX, Modeling, QA")
    print(f"Project: {PROJECT_ROOT}")
    print(f"{'='*60}\n")
    print(f"Task: {prompt}\n")
    print("-" * 60)

    try:
        async for message in query(prompt=prompt, options=options):
            # Print assistant text responses
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text, end="")
                    elif isinstance(block, ToolUseBlock):
                        if block.name == "Task":
                            agent_type = block.input.get("subagent_type", "unknown")
                            description = block.input.get("description", "")
                            print(f"\n>>> Delegating to {agent_type}: {description}")
                print()  # newline after message

            # Print final result
            if isinstance(message, ResultMessage):
                print("\n" + "-" * 60)
                if message.is_error:
                    print(f"ERROR: {message.result}")
                else:
                    print("Task completed successfully.")
                if message.total_cost_usd is not None:
                    print(f"Cost: ${message.total_cost_usd:.4f}")
                print(f"Duration: {message.duration_ms / 1000:.1f}s")
                print(f"Turns: {message.num_turns}")
    except CLINotFoundError:
        print("\nERROR: Claude Code CLI not found.")
        print("Install it with: npm install -g @anthropic-ai/claude-code")
        sys.exit(1)
    except ProcessError as e:
        print(f"\nERROR: Process failed (exit code {e.exit_code})")
        if e.stderr:
            print(f"  {e.stderr}")
        sys.exit(1)
    except CLIJSONDecodeError as e:
        print(f"\nERROR: Failed to parse SDK response: {e}")
        sys.exit(1)


async def run_single_agent(agent_name: str, prompt: str) -> None:
    """Run a single specialist agent directly (bypass PM)."""

    agents_map = {
        "ux": ("ux-specialist", UX_AGENT),
        "modeling": ("modeling-specialist", MODELING_AGENT),
        "qa": ("qa-specialist", QA_AGENT),
    }

    if agent_name not in agents_map:
        print(f"Unknown agent: {agent_name}")
        print(f"Available: {', '.join(agents_map.keys())}")
        return

    name, agent_def = agents_map[agent_name]

    options = ClaudeAgentOptions(
        system_prompt=agent_def.prompt,
        allowed_tools=agent_def.tools or [],
        permission_mode="acceptEdits",
        cwd=PROJECT_ROOT,
        model=agent_def.model,
        max_turns=20,
    )

    print(f"\n{'='*60}")
    print(f"CRUNCH — {name}")
    print(f"{'='*60}\n")
    print(f"Task: {prompt}\n")
    print("-" * 60)

    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text, end="")
                print()

            if isinstance(message, ResultMessage):
                print("\n" + "-" * 60)
                if message.is_error:
                    print(f"ERROR: {message.result}")
                else:
                    print("Task completed successfully.")
                if message.total_cost_usd is not None:
                    print(f"Cost: ${message.total_cost_usd:.4f}")
    except CLINotFoundError:
        print("\nERROR: Claude Code CLI not found.")
        print("Install it with: npm install -g @anthropic-ai/claude-code")
        sys.exit(1)
    except ProcessError as e:
        print(f"\nERROR: Process failed (exit code {e.exit_code})")
        if e.stderr:
            print(f"  {e.stderr}")
        sys.exit(1)
    except CLIJSONDecodeError as e:
        print(f"\nERROR: Failed to parse SDK response: {e}")
        sys.exit(1)


def print_usage():
    """Print usage instructions."""
    print("""
CRUNCH Agent Team
=================

Usage:
  python main.py "task description"           Run with PM orchestrator
  python main.py --agent ux "task"            Run UX specialist directly
  python main.py --agent modeling "task"      Run Modeling specialist directly
  python main.py --agent qa "task"            Run QA specialist directly
  python main.py --help                       Show this help

Examples:
  python main.py "Add a tooltip showing float days on Gantt bars"
  python main.py "Fix the backward pass for SF relationships"
  python main.py --agent qa "Design test cases for the XER parser"
  python main.py --agent ux "Improve the cost summary card layout"
  python main.py --agent modeling "Verify the OT fatigue table interpolation"

Environment:
  ANTHROPIC_API_KEY    Required. Get one at https://console.anthropic.com/
""")


def main():
    """Parse arguments and run the appropriate agent."""
    args = sys.argv[1:]

    if not args or "--help" in args or "-h" in args:
        print_usage()
        return

    # Direct agent mode: --agent <name> "prompt"
    if "--agent" in args:
        idx = args.index("--agent")
        if idx + 2 > len(args):
            print("Usage: python main.py --agent <ux|modeling|qa> \"task\"")
            return
        agent_name = args[idx + 1]
        prompt = " ".join(args[idx + 2:])
        asyncio.run(run_single_agent(agent_name, prompt))
        return

    # PM orchestrator mode (default)
    prompt = " ".join(args)
    asyncio.run(run_team(prompt))


if __name__ == "__main__":
    main()
