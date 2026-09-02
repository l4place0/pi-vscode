export interface UriLike {
  fsPath: string;
}

export interface WorkspaceFolderLike {
  uri: UriLike;
}

export interface WorkspaceResolutionContext<TUri extends UriLike = UriLike> {
  workspaceFolders: readonly WorkspaceFolderLike[] | undefined;
  activeDocumentUri: TUri | undefined;
  getWorkspaceFolder(uri: TUri): WorkspaceFolderLike | undefined;
}

export function selectWorkingDirectory<TUri extends UriLike>(
  context: WorkspaceResolutionContext<TUri>,
  resourceUri?: TUri,
): string | undefined {
  const resourceFolder = resourceUri ? context.getWorkspaceFolder(resourceUri) : undefined;
  if (resourceFolder) return resourceFolder.uri.fsPath;

  const activeFolder = context.activeDocumentUri
    ? context.getWorkspaceFolder(context.activeDocumentUri)
    : undefined;
  return activeFolder?.uri.fsPath ?? context.workspaceFolders?.[0]?.uri.fsPath;
}
