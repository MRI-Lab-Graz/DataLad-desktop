// Decides whether a command must wait for a git identity (user.name/user.email).
// Pure logic - the dialog and IPC live in app.js.

// Commands that create a git commit or an annotated tag (re-verified against adapter.js: save, create,
// create-subdataset, update, tag -a).
const COMMIT_COMMANDS = new Set(['save', 'createProject', 'createSubdataset', 'update', 'createTag'])

// `identity` is null until the first read finishes: unknown never blocks.
// `available: false` (git missing) never blocks either - Check Environment reports it.
export function shouldBlockForIdentity(commandName, identity) {
  return COMMIT_COMMANDS.has(commandName) && Boolean(identity?.available) && !identity.complete
}

// Shaped like a real runner result so the result renderers accept it.
export function identityMissingResult(commandName) {
  return {
    ok: false,
    commandName,
    exitCode: 1,
    stdout: '',
    stderr: '',
    failed: true,
    warnings: [],
    userError: {
      code: 'IDENTITY_MISSING',
      title: 'Name and email needed',
      message: "Set your name and email first. It's asked once, and you can change it any time in Setup.",
      technicalDetails: ''
    }
  }
}
