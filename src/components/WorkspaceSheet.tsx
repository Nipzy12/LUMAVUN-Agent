import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Project } from '../types';
import { id, safePath } from '../paths';
import { C, PrimaryButton, Sheet, style } from '../ui';
import {
  createProjectFolder, importTextFile, listProjectFiles,
  readProjectFile, shareProjectFile, writeProjectFile
} from '../workspace';

export function WorkspaceSheet({ open, onClose, projects, activeId, onCreate, onSelect, onFileSaved }: {
  open: boolean; onClose: () => void; projects: Project[]; activeId: string;
  onCreate: (project: Project) => void;
  onSelect: (id: string) => void;
  onFileSaved?: (projectId: string, path: string, content: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const active = projects.find(p => p.id === activeId);
  function refresh() {
    if (!activeId) { setFiles([]); return; }
    try { setFiles(listProjectFiles(activeId)); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Cannot load project files'); }
  }
  useEffect(() => { if (open) { refresh(); setFilePath(null); } }, [open, activeId]);

  function createProject() {
    try {
      const name = newName.trim();
      if (!name || name.length > 45) throw new Error('Enter a project name (1–45 characters)');
      const project = { id: id('project'), name, createdAt: Date.now(), updatedAt: Date.now() };
      createProjectFolder(project.id);
      onCreate(project);
      setNewName('');
      setStatus('Project created: ' + name);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Cannot create project'); }
  }
  async function openFile(path: string) {
    if (!activeId) return;
    setWorking(true);
    try {
      const text = await readProjectFile(activeId, path);
      setFilePath(path);
      setContent(text);
      setStatus('');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Read failed'); }
    finally { setWorking(false); }
  }
  async function saveFile() {
    if (!activeId || !filePath) return;
    setWorking(true);
    try {
      await writeProjectFile(activeId, filePath, content);
      onFileSaved?.(activeId, filePath, content);
      refresh(); setStatus('Saved: ' + filePath);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Save failed'); }
    finally { setWorking(false); }
  }
  async function importFile() {
    if (!activeId) return;
    setWorking(true);
    try {
      const path = await importTextFile(activeId);
      refresh();
      if (path) {
        const imported = await readProjectFile(activeId, path);
        onFileSaved?.(activeId, path, imported);
        setStatus('Imported ' + path);
        await openFile(path);
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed'); }
    finally { setWorking(false); }
  }
  async function share() {
    if (!activeId || !filePath) return;
    try { await shareProjectFile(activeId, filePath); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Share failed'); }
  }

  return <Sheet open={open} onClose={onClose} title="Code Workspace">
    <Text style={style.subtitle}>
      Projects and file edits live in the app's own private directory. The AI cannot reach your other phone files.
    </Text>
    <Text style={style.label}>YOUR PROJECTS</Text>
    {projects.map(p => <Pressable key={p.id} style={[style.card, style.row,
      activeId === p.id && { borderWidth: 1, borderColor: C.accent }]}
      onPress={() => { onSelect(p.id); setFilePath(null); }}>
      <Feather name="folder" color={C.gold} size={19} />
      <Text style={[style.txt, { marginLeft: 10, flex: 1 }]}>{p.name}</Text>
      {activeId === p.id && <Feather name="check" color={C.accent} size={19} />}
    </Pressable>)}
    <View style={[style.row, { gap: 8 }]}>
      <TextInput style={[style.input, { flex: 1 }]} value={newName} onChangeText={setNewName}
        placeholder="New project name" placeholderTextColor={C.subtle} />
      <Pressable style={style.button} onPress={createProject}>
        <Feather name="plus" color={C.bg} size={20} />
      </Pressable>
    </View>
    {active && <>
      <View style={style.divider} />
      <Text style={style.label}>{active.name.toUpperCase()} • FILES</Text>
      <View style={[style.row, { gap: 8 }]}>
        <TextInput style={[style.input, { flex: 1 }]} value={pathDraft} onChangeText={setPathDraft}
          autoCapitalize="none" placeholder="src/index.ts" placeholderTextColor={C.subtle} />
        <Pressable style={style.button} onPress={() => {
          try {
            const path = safePath(pathDraft);
            if (files.includes(path)) throw new Error('File already exists');
            setFilePath(path); setContent(''); setPathDraft('');
          } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid file'); }
        }}>
          <Feather name="file-plus" color={C.bg} size={19} />
        </Pressable>
      </View>
      <PrimaryButton title="Import text file from phone" kind="outline" disabled={working}
        onPress={() => { void importFile(); }} />
      {files.length === 0 && <Text style={style.subtitle}>No files yet. Import or create a file, or ask the Code Agent.</Text>}
      {files.map(path => <Pressable key={path} onPress={() => { void openFile(path); }}
        style={[style.row, { paddingVertical: 9, gap: 10 }]}>
        <Feather name="file-text" size={16} color={C.accent} />
        <Text style={[style.txt, { fontSize: 13, flex: 1 }]}>{path}</Text>
        <Feather name="chevron-right" color={C.muted} size={16} />
      </Pressable>)}
      {filePath && <>
        <View style={style.divider} />
        <Text style={style.label}>EDITOR: {filePath}</Text>
        <TextInput style={[style.input, { minHeight: 230, textAlignVertical: 'top', fontFamily: 'monospace' }]}
          value={content} onChangeText={setContent} multiline autoCapitalize="none" autoCorrect={false} />
        <PrimaryButton title="Simpan file & perbarui artefak" onPress={() => { void saveFile(); }} disabled={working} />
        {files.includes(filePath) && <PrimaryButton title="Export / Share file" kind="outline" onPress={() => { void share(); }} />}
      </>}
    </>}
    {working && <ActivityIndicator color={C.accent} />}
    {!!status && <Text style={{ color: C.gold, fontSize: 12 }}>{status}</Text>}
  </Sheet>;
}
