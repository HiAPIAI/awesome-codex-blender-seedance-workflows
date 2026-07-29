export function parseArgs(argv, booleanNames = new Set()) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equal = raw.indexOf("=");
    const name = equal === -1 ? raw : raw.slice(0, equal);
    if (booleanNames.has(name)) {
      options[name] = true;
      continue;
    }
    const value = equal === -1 ? argv[++index] : raw.slice(equal + 1);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    options[name] = value;
  }
  return { options, positionals };
}
