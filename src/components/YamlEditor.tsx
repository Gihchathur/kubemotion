import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
}

function YamlEditor({ value, onChange }: YamlEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  onChangeRef.current = onChange

  useEffect(() => {
    if (!editorContainerRef.current) {
      return
    }

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        yaml(),
        oneDark,
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
            backgroundColor: '#0b1220',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
          '.cm-gutters': {
            backgroundColor: '#0b1220',
            color: '#475569',
            border: 'none',
          },
          '.cm-activeLineGutter': {
            backgroundColor: '#172033',
          },
          '.cm-activeLine': {
            backgroundColor: '#172033',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current,
    })

    editorViewRef.current = view

    return () => {
      view.destroy()
      editorViewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = editorViewRef.current

    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()

    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      })
    }
  }, [value])

  return <div ref={editorContainerRef} className="yaml-codemirror" />
}

export default YamlEditor