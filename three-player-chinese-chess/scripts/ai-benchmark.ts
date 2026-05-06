import { runAiBenchmark } from "../src/core/ai-lab";

if (process.env.AI_BENCHMARK_ENTRY === "1") {
  console.log(JSON.stringify(runAiBenchmark(), null, 2));
}
