# Revu Guidelines

## Product direction

- Revu is a lightweight Windows desktop code editor, not a VS Code extension.
- Use Electron + React + TypeScript + Monaco. The renderer stays UI-only; filesystem, Git, watching, dialogs, and window operations run in Electron through a narrow preload bridge.
- Keep the editor focused. Do not add plugin systems, service layers, compatibility fallbacks, AI suggestions, or agent features until they are explicitly requested.
- Use English for every user-facing label, message, menu, tooltip, and setting.
- Keep code and UI copy concise. Avoid speculative abstractions, excessive fallback logic, and redundant tests.

## Electron shell

- Keep `contextIsolation: true` and `nodeIntegration: false`.
- Use Electron's native `dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })` for folders. Do not use PowerShell, VBScript, helper executables, or browser file APIs.
- The window is frameless. Do not add a fixed title bar or reserve vertical title-bar space.
- Minimize, Maximize/Restore, and Close are three circular controls rendered through a top-level portal at the application’s top-right on every page. Their full hit area must stay above drag regions and be explicitly non-draggable. Keep the parent tab/project bars non-draggable so the reserved right padding beneath the controls cannot capture clicks.
- F12 toggles DevTools in development and packaged builds.
- Use native Electron context menus. Current scope is:
  - project root: `Close Folder`
  - editor tab: `Close`, `Close Others`, `Close All`
- Closing a folder stops its watchers, disposes its Monaco models, removes its tabs and session review state, and never changes disk files. Confirm once before discarding dirty drafts.

## Editor and layout

- The primary layout is Activity Bar | File/Review/Settings sidebar | editor.
- Multiple project folders may be open at once.
- File, Review, and Settings are peers and use consistent sidebar styling. Sidebars are resizable.
- Sidebar widths are synchronized by default. Settings -> Interaction can make them independent.
- Editor tabs support:
  - `Isolated`: project tabs above file tabs
  - `Mixed`: one file-tab row across projects
- Tab mode affects only the editor. It belongs in Settings -> Interaction, defaults to Isolated, and persists in `localStorage`.
- Theme and UI preferences may persist locally. Drafts and review decisions remain session-only.

## Git and document state

- For each open file maintain:
  - `B`: fixed review baseline captured from HEAD
  - `S`: last synchronized disk content and hash
  - `D`: current Monaco draft
- Review compares `B -> D`. Dirty state compares `S -> D`.
- Staged and unstaged Git changes are shown together against the fixed HEAD baseline.
- Save updates `S` only. Save, Accept, and Reject never stage files or modify the Git index.
- If HEAD changes, keep the old baseline and require an explicit base refresh. Refreshing the base keeps drafts and clears that project’s review decisions.
- External changes merge immediately with Git three-way merge using `S` as the ancestor. A conflict keeps the draft, blocks save/review for that file, and requires explicit merge completion.
- Save requests include the expected disk hash. Never silently overwrite a newer external version.

## Review behavior

- Keep the standard `Review` title at the top of the sidebar.
- The changed-file list is a separate bottom section. Its own single-row header contains project scope, branch when one project is in scope, and project-level Accept, Reject, and Undo.
- With one open project, show its name directly and do not show `All Projects` or a duplicate project group row. With multiple projects and one selected, show the selector in the header and list files directly without a duplicate group row.
- Show project group rows only when multiple projects are open and `All Projects` is selected. In that view, project-level actions apply to all open projects.
- The Review sidebar shows the selected file’s chunk details above a persistent changed-file list. Do not show chunk details until a file is selected.
- Clicking a changed file opens it in the editor and shows its chunks without leaving the current All Projects filter.
- Project-level operations require one summary confirmation and must prevalidate every affected file before changing any file:
  - Accept: accept all pending chunks without changing draft text
  - Reject: restore all pending chunks in the drafts
  - Undo: restore all reviewed chunks to pending
- Chunk-level semantics:
  - Accept keeps `D` and records the decision
  - Reject restores the chunk’s base text in `D`
  - Undo Accept removes the decision without editing text
  - Undo Reject restores the rejected change
- Accepted and rejected records remain visible with Undo. Invalid records remain visible as Stale and cannot mutate text.
- Chunk labels are `Add`, `Modify`, and `Delete`; do not use `Pending` as the chunk type.
- Pending colors are green for Add, orange for Modify, and red for Delete. Reviewed chunks use the theme’s neutral surface.
- Accept text is green, Reject text is red, and Undo uses the theme foreground.
- Prev and Next exist only on inline editor chunk toolbars. Review-sidebar chunk cards do not show navigation buttons.
- Navigation wraps within the current file, centers the target chunk, and highlights only its action bar with a shadow. Never outline the complete chunk or include deleted-code rows in the highlight.
- Inline deleted text must preserve source indentation while matching Monaco’s font, line height, content origin, and `tabSize: 2`.
- Deleted, renamed, binary, mixed-line-ending, and unresolved-conflict files are status-only and have no chunk actions.

## Validation

- Add tests only for important state/version logic or regressions. Do not mirror implementation details.
- Before handoff run:
  - `npm test`
  - `npm run build`
  - `git diff --check`
- Do not package after routine code changes. The user runs `npm run dist` manually when a portable executable is needed.
