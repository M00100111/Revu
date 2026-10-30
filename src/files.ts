export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(action: string, data: object = {}): Promise<T> {
  const result=await window.revu.invoke<T>({action,...data});
  if(!result.ok)throw new ApiError(result.status??500,result.error??'Unknown error');
  return result.value as T;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
