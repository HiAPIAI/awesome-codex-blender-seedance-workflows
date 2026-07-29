# Research Notes

Research performed on 2026-07-29 using public GitHub metadata, repository documentation, and Exa semantic search. Stars are a point-in-time signal, not a quality guarantee.

| Project | Observed strength | Decision used here |
|---|---|---|
| [Evolink-AI/Awesome-Blender-Seedance-Workflow-Usecases](https://github.com/Evolink-AI/Awesome-Blender-Seedance-Workflow-Usecases) | A large attributed case library organized around camera, blocking, agents, and limitations; CC BY 4.0 content. | Do not compete on copied social cases. Provide original executable workflows, automated checks, and HiAPI handoff instead. |
| [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | Popular MIT-licensed interactive Blender control over MCP, including scene inspection and arbitrary Python execution. | Keep Blender MCP optional for exploration; the committed handoff uses a constrained JSON schema and never accepts arbitrary generated Python. |
| [wassermanproductions/blockout](https://github.com/wassermanproductions/blockout) | Apache-2.0 desktop gray-box editor with real lens math, choreography marks, deterministic export, generator profiles, and MCP control. | Avoid rebuilding a large editor. Focus on a small Git-native Blender compiler and direct HiAPI lifecycle; document Blockout as a strong upstream authoring option. |
| [wassermanproductions/motion-previs-studio](https://github.com/wassermanproductions/motion-previs-studio) | Apache-2.0 reference analysis with pose, depth, camera, and production-pack exports. | Defer pose/depth extraction to future adapters rather than embedding a second analysis application in P0. |
| [ZeroLu/awesome-seedance](https://github.com/ZeroLu/awesome-seedance) | MIT-licensed multilingual prompt and example gallery. | Keep the repository task-oriented and executable rather than optimizing for prompt volume. |
| [Emily2040/seedance-2.0](https://github.com/Emily2040/seedance-2.0) | Broad agent operating guidance for reference roles, shot planning, continuity, and multilingual prompting. | Preserve explicit reference-role, continuity, and human-review language in the compiler, while keeping the P0 schema compact. |
| [AceDataCloud/SeedanceMCP](https://github.com/acedatacloud/seedancemcp) | MCP task creation, polling, model discovery, and batch operations for another provider. | Provide submit/poll/resume behavior locally, but keep provider routing on HiAPI `/v1/tasks` and default to dry-run. |

No source code, prompt text, screenshots, or videos from these projects are copied into this repository. The implementation and example shots are original. External tools retain their own licenses and trademarks.

## Competitive gap

The direct competitor is strong at discovery but weak at reproducible execution. The full desktop tools are strong at interactive authoring but much larger than a repository-first workflow needs. The resulting gap is a compact, inspectable contract that Codex can edit, Blender can render headlessly, Git can review, and HiAPI can submit safely.
