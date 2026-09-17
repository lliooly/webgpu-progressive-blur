import { runPresetValidation } from "./presets";
import { runGpuValidation } from "./harness";

const output = document.querySelector<HTMLPreElement>("#result");
if (!output) throw new Error("GPU validation result element is missing.");

runGpuValidation()
  .then(async (report) => {
    const presets = await runPresetValidation();
    document.body.dataset.status = report.status;
    output.textContent = JSON.stringify(
      {
        ...report,
        status: report.status === "passed" ? presets.status : report.status,
        presets,
      },
      null,
      2,
    );
  })
  .catch((error: unknown) => {
    document.body.dataset.status = "failed";
    output.textContent = JSON.stringify(
      {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  });
