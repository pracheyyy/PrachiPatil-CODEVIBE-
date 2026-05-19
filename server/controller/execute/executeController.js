// controllers/execute/executeController.js
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const ExecuteLog = require("../../models/execute.model");
const { runMongoSimulation, isMongoCode } = require("../../utils/mongoSimulator");

const runCommandWithTempFile = (commandBuilder, code, ext) =>
  new Promise((resolve, reject) => {
    const filename = `temp_${Date.now()}.${ext}`;
    const filepath = path.join(process.cwd(), filename);

    try {
      fs.writeFileSync(filepath, code);
    } catch (e) {
      return reject(`Failed to write temp file: ${e.message}`);
    }

    exec(commandBuilder(filepath), { timeout: 8000 }, (error, stdout, stderr) => {
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { }
      try { if (fs.existsSync(`${filepath}.out`)) fs.unlinkSync(`${filepath}.out`); } catch { }
      try { if (fs.existsSync(`${filepath.replace(/\.\w+$/, ".class")}`)) fs.unlinkSync(`${filepath.replace(/\.\w+$/, ".class")}`); } catch { }

      if (error) return reject(stderr || error.message);
      resolve(stdout);
    });
  });

const executeCode = async (req, res) => {
  const { language } = req.params;
  const { email = "jia@gmail.com", code = "" } = req.body || {};

  if (!code.trim()) return res.status(400).json({ message: "No code provided" });

  let output = "", err = "";

  try {
    switch ((language || "").toLowerCase()) {
      case "c":
        output = await runCommandWithTempFile((file) => `gcc "${file}" -o "${file}.out" && "${file}.out"`, code, "c");
        break;
      case "cpp":
        output = await runCommandWithTempFile((file) => `g++ "${file}" -o "${file}.out" && "${file}.out"`, code, "cpp");
        break;
      case "python":
        output = await runCommandWithTempFile((file) => `python3 "${file}"`, code, "py");
        break;
      case "java":
        output = await runCommandWithTempFile((file) =>
          `javac "${file}" && java -cp "${path.dirname(file)}" ${path.basename(file, ".java")}`, code, "java");
        break;
      case "node":
      case "javascript":
        // ✅ KEY LOGIC:
        // If the code contains MongoDB patterns → run through simulator
        // Otherwise → run normally with Node.js
        if (isMongoCode(code)) {
          output = await runMongoSimulation(code);
        } else {
          output = await runCommandWithTempFile(
            (f) => `node "${f}"`,
            code, "js"
          );
        }
        break;

      // ── Mongo / DBMS (explicit) ───────────────────────────
      case "mongo":
      case "dbms":
        output = await runMongoSimulation(code);
        break;

      default:
        return res.status(400).json({ message: `Language '${language}' not supported` });
    }
  } catch (e) {
    err = e?.toString() || "Unknown execution error";
  }

  try {
    await ExecuteLog.create({
      email,
      language,
      code,
      output: err ? "" : String(output || "").trim(),
      error: err ? String(err).trim() : ""
    });
  } catch (dbErr) {
    // ignore logging failure
    console.warn("ExecuteLog create failed:", dbErr?.message || dbErr);
  }

  if (err) return res.status(400).json({ message: "Execution error", error: err });
  res.json({ output: String(output || "").trim() });
};

module.exports = { executeCode };
