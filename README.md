# ddc-mocword: mocword completion for ddc.vim

A ddc.vim source for `mocword` for completing words in English.

**Note: "mocword" binary must be installed in your `$PATH`!!**


## Dependencies

* https://github.com/high-moctane/mocword

* https://github.com/high-moctane/mocword-data

* Set `$mocword_DATA_PATH` environment variable

Please test `mocword -n 100 -g` works from command line.


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
