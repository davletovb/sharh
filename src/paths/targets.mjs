// Only generation-affecting fields define a target; object order and UI labels do not.
export const targetKey=t=>JSON.stringify(['path','provider','model','effort','serviceTier'].map(k=>t?.[k]??null));
