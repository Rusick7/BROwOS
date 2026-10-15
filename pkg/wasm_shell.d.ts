declare namespace wasm_bindgen {
	/* tslint:disable */
	/* eslint-disable */
	export class Shell {
	  free(): void;
	  close_active(): void;
	  show_history(): void;
	  bookmark_current(): void;
	  constructor();
	  boot(): void;
	  go_fwd(): void;
	  reload(): void;
	  go_back(): void;
	  go_home(): void;
	  restore(): void;
	  minimize(): void;
	  navigate(raw: string): void;
	  open_url(url: string): void;
	  close_all(): void;
	}
	
}

declare type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

declare interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_shell_free: (a: number, b: number) => void;
  readonly shell_bookmark_current: (a: number) => void;
  readonly shell_boot: (a: number) => void;
  readonly shell_close_active: (a: number) => void;
  readonly shell_close_all: (a: number) => void;
  readonly shell_go_back: (a: number) => void;
  readonly shell_go_fwd: (a: number) => void;
  readonly shell_go_home: (a: number) => void;
  readonly shell_minimize: (a: number) => void;
  readonly shell_navigate: (a: number, b: number, c: number) => void;
  readonly shell_new: () => number;
  readonly shell_open_url: (a: number, b: number, c: number) => void;
  readonly shell_reload: (a: number) => void;
  readonly shell_restore: (a: number) => void;
  readonly shell_show_history: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_1: WebAssembly.Table;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_5: WebAssembly.Table;
  readonly closure64_externref_shim: (a: number, b: number, c: any) => void;
  readonly __wbindgen_start: () => void;
}

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
declare function wasm_bindgen (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
