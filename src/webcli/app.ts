import { executeCommand } from './commandDispatcher';
import { WebCliRuntime } from './runtime';

class WebCLI {
  private inputEl: HTMLInputElement;
  private history: string[] = [];
  private historyIndex = -1;
  private runtime: WebCliRuntime;

  constructor(terminalEl: HTMLElement, inputEl: HTMLInputElement) {
    this.inputEl = inputEl;
    this.runtime = new WebCliRuntime(terminalEl);
    this.runtime.printStartup();
    this.bindInput();
  }

  private bindInput() {
    this.inputEl.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        const raw = this.inputEl.value.trim();
        this.inputEl.value = '';
        if (!raw) return;

        this.history.push(raw);
        this.historyIndex = this.history.length;
        this.runtime.write(`hush> ${raw}`, 'muted');
        await executeCommand(this.runtime, raw);
      }

      if (event.key === 'ArrowUp') {
        if (this.history.length === 0) return;
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.inputEl.value = this.history[this.historyIndex] ?? '';
        event.preventDefault();
      }

      if (event.key === 'ArrowDown') {
        if (this.history.length === 0) return;
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        this.inputEl.value = this.history[this.historyIndex] ?? '';
        event.preventDefault();
      }
    });
  }
}

const terminalEl = document.getElementById('terminal');
const inputEl = document.getElementById('cli-input');

if (!(terminalEl instanceof HTMLElement) || !(inputEl instanceof HTMLInputElement)) {
  throw new Error('Terminal UI not found.');
}

new WebCLI(terminalEl, inputEl);
