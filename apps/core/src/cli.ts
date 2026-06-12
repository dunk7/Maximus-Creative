import { runGenesisBoot } from "./genesis.js";
import { printStatus, runSingleTick, startImmortalLoop } from "./loop.js";

const command = process.argv[2] ?? "start";

async function main(): Promise<void> {
  switch (command) {
    case "genesis":
      await runGenesisBoot();
      break;
    case "start":
      await startImmortalLoop();
      break;
    case "tick-once":
      await runSingleTick();
      break;
    case "status":
      printStatus();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
