' Abre o versionador sem nenhuma janela de terminal junto.
'
' O "npm start" prendia um console do cmd pela vida inteira do aplicativo: era
' ele que ficava aberto do lado. Aqui o electron.exe e chamado direto, e ele e
' um programa de janela (nao de console), entao nao abre terminal nenhum.
'
' Este arquivo nao tem acentos de proposito: o Windows Script Host le o .vbs na
' pagina de codigo do sistema e texto acentuado sai trocado.
Option Explicit

Dim shell, fso, pasta, electron
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

pasta = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "versionador")
electron = fso.BuildPath(pasta, "node_modules\electron\dist\electron.exe")

' Primeira vez na maquina: a instalacao das dependencias aparece, para dar
' sinal de vida (sao uns 200 MB de Electron)
If Not fso.FolderExists(fso.BuildPath(pasta, "node_modules")) Then
  shell.CurrentDirectory = pasta
  shell.Run "cmd /c npm install", 1, True
End If

If Not fso.FileExists(electron) Then
  MsgBox "Nao achei o Electron em:" & vbCrLf & electron & vbCrLf & vbCrLf & _
         "Abra um terminal na pasta 'versionador' e rode: npm install", 16, "Versionador"
  WScript.Quit 1
End If

shell.CurrentDirectory = pasta
shell.Run """" & electron & """ .", 1, False
