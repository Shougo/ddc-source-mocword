# ddc-mocword: mocword completion for ddc.vim

A ddc.vim source for `mocword` for completing words in English.

**Note: "mocword" binary must be installed in your `$PATH`!!**

## Dependencies

- https://github.com/high-moctane/mocword

- https://github.com/high-moctane/mocword-data

- Set `$MOCWORD_DATA` environment variable

Please test `mocword --limit 100` works from command line.

## Configuration

```vim
call ddc#custom#patch_global('sources', ['mocword'])
call ddc#custom#patch_global('sourceOptions', {
    \ 'mocword': {
    \   'mark': 'mocword',
    \   'minAutoCompleteLength': 3,
    \   'isVolatile': v:true,
    \ }})
```

## License

MIT
