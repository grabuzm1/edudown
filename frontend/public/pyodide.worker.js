/* Pyodide Web Worker: изолированное выполнение Python.
   input(): SAB + Atomics.wait (если crossOriginIsolated), иначе async-мост. */
let pyodide = null
let sab = null, i32 = null, buf = null
let pendingInput = null

const post = (m) => self.postMessage(m)

/* Синхронный input через SharedArrayBuffer */
function syncInput(prompt) {
  post({ type: 'input', prompt: prompt || '' })
  Atomics.store(i32, 0, 0)
  Atomics.wait(i32, 0, 0)           // блокируем ТОЛЬКО воркер, не UI
  const len = i32[1]
  return new TextDecoder().decode(buf.slice(0, len))
}
/* Асинхронный input (fallback без COOP/COEP) */
function asyncInput(prompt) {
  post({ type: 'input', prompt: prompt || '' })
  return new Promise((res) => { pendingInput = res })
}

/* AST-обёртка для fallback: input() и вызовы своих функций становятся await */
const TRANSFORM = `
import ast
def _wrap(src):
    tree = ast.parse(src)
    names = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    class T(ast.NodeTransformer):
        def visit_FunctionDef(self, n):
            self.generic_visit(n)
            n.__class__ = ast.AsyncFunctionDef
            return n
        def visit_Call(self, n):
            self.generic_visit(n)
            f = n.func
            if isinstance(f, ast.Name) and (f.id == 'input' or f.id in names):
                if f.id == 'input': f.id = '__input'
                return ast.copy_location(ast.Await(value=n), n)
            return n
    tree = T().visit(tree)
    main = ast.AsyncFunctionDef(
        name='__main__',
        args=ast.arguments(posonlyargs=[], args=[], vararg=None, kwonlyargs=[],
                           kw_defaults=[], kwarg=None, defaults=[]),
        body=tree.body or [ast.Pass()], decorator_list=[], returns=None, type_comment=None)
    mod = ast.Module(body=[main, ast.Expr(value=ast.Await(value=ast.Call(
        func=ast.Name(id='__main__', ctx=ast.Load()), args=[], keywords=[])))],
        type_ignores=[])
    ast.fix_missing_locations(mod)
    return compile(mod, '<student>', 'exec')
`

self.onmessage = async (e) => {
  const m = e.data
  if (m.type === 'init') {
    sab = m.sab || null
    if (sab) { i32 = new Int32Array(sab, 0, 4); buf = new Uint8Array(sab, 16, 4096) }
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js')
    pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' })
    pyodide.setStdout({ batched: (s) => post({ type: 'stdout', text: s }) })
    pyodide.setStderr({ batched: (s) => post({ type: 'stderr', text: s }) })
    post({ type: 'ready' })
    return
  }
  if (m.type === 'input_reply') {
    if (pendingInput) { pendingInput(m.text); pendingInput = null }
    return
  }
  if (m.type === 'run') {
    const globals = pyodide.toPy({})
    globals.set('__input', sab ? syncInput : asyncInput)
    const src = m.code + (m.testCode ? '\n\n# --- скрытые тесты ---\n' + m.testCode : '')
    const py = (sab ? '' : TRANSFORM) + `
import builtins
builtins.input = __input
__src = ${JSON.stringify(src)}
${sab ? 'exec(compile(__src, "<student>", "exec"), globals())' : 'exec(_wrap(__src), globals())'}
`
    try {
      await pyodide.runPythonAsync(py, { globals })
      post({ type: 'done' })
    } catch (err) {
      post({ type: 'error', text: String(err.message || err).trim() })
    } finally {
      globals.destroy()
    }
  }
}