import { GhostscriptOptimizer } from "./ghostscript-optimizer";
import type { IPdfOptimizer, OptimizationOptions, OptimizationResult } from "../types";

export class OptimizerManager {
  private ghostscriptOptimizer = new GhostscriptOptimizer();

  async getAvailableOptimizers(): Promise<string[]> {
    if (await this.ghostscriptOptimizer.isAvailable()) {
      return [this.ghostscriptOptimizer.name];
    }
    return [];
  }

  async optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult> {
    if (!(await this.ghostscriptOptimizer.isAvailable())) {
      throw new Error("Ghostscript optimization engine is not installed or available on the server.");
    }
    return await this.ghostscriptOptimizer.optimize(inputBuffer, options);
  }
}
